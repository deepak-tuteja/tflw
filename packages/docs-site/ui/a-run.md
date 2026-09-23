---
pageClass: ui-shots
---

# Reading a run

The **Run** tab shows what happened when this project last ran, read from the run directory on disk
— the same `results.json` that `report.html` is rendered from. It is not a live console and it does
not re-run anything by being looked at.

![A run read in place: verdicts beside the file that produced them](/ui/run-paper.png){.light-only}
![A run read in place: verdicts beside the file that produced them](/ui/run-terminal.png){.dark-only}

## What a run carries

Each test in the run reports a verdict and the steps that produced it. A failed step names what was
expected and what arrived, in the same words the terminal uses — the page renders the run, it does
not re-word it.

Where a run judged anything by a security rule, a panel above the files says what it judged and —
more usefully — what it **declined** to judge. The run in the picture passed 36 of 36 and still
reports two things a green verdict would otherwise hide: that none of its 24 api steps sits in a
test declaring an owner, so `authorization violations` had nothing to grade; and that one probe was
stood down, because a synthesized `POST /login` is a write and this origin's `authorized target`
does not declare `probe mutating`. Neither is a failure. Both are the difference between *nothing
was found* and *nothing was looked for*.

For browser tests, a failed attempt can carry a Playwright trace. The page serves that trace to
Playwright's own viewer, from the `playwright-core` the project already resolves, so opening one
needs no extra install and spawns nothing. Where a project has no `playwright-core`, the page says
so and gives you the command that opens the archive yourself.

## Running from the page

The run strip starts a run of the project and streams its output while it goes. It is the same
command a terminal would run, with the same environment: the server's, not your shell's. Start the
page where a run would work and a run started from it works too.

What comes back is a real run — it writes a real run directory, and the next reader of that project
sees it. Nothing about being started from a page makes a run provisional.

## Comparing two runs

Where a project has more than one run directory, one can be read against another: the compared run's
column appears beside the current one, with the difference called out. This is how a threshold that
has started drifting becomes visible before it breaches.

**The control is not in the picture above, and its absence is the rule working.** The example has
run once, so there is nothing to compare against and the page offers no chooser rather than an empty
one — the same reasoning as a door with no tests behind it. Run the suite a second time and the
chooser appears beside the run's own chip.

For load tests specifically, the planned and achieved rates are drawn on one plot, so a workload
that did not reach its target is a picture rather than an inference.

## What a verdict is not

A green run says every assertion that ran passed. It does not say the test asserted anything worth
asserting, and the page does not pretend otherwise — a test with no assertions runs, passes and is
shown passing. Reading the Compose tab beside the Run tab is how you tell the difference, which is
most of why they are tabs over one file rather than two screens.
