---
pageClass: ui-shots
---

# What the page will not do

Some of this is work not yet done and some of it is deliberate. They are separated here because a
limitation you can plan around is worth more than a gap you discover.

## By design

**It is not a dashboard, and it does not aggregate.** The page reads one project: the directory you
served. It has no view across repositories, no history beyond the run directories on disk, and no
notion of a team. A project's history lives in `git` and its runs live in its run directory; the
page reads those and adds nothing of its own.

**It keeps no state.** No database, no sidecar file, no hidden directory. Which door and which file
you are on live in the address bar, so a link is shareable and a reload changes nothing. Your theme
lives in your browser. Everything else is the project on disk, which means the page can be closed at
any moment without losing anything that was not already a file.

**It does not lint your taste.** The page will happily show you a passing test that asserts nothing.
A verdict is about what ran, and the page reports it faithfully rather than editorialising.

**It is local.** `tflw ui` serves on the loopback interface for the person who started it. There is
no authentication because there is no remote access to authenticate, and making it remotely
reachable is not something the command offers.

## Not yet

**Compose does not write every construct the language has.** The doors' forms cover the constructs
each door's work is built from, and the language is larger than that. Anything Compose cannot write,
the **Source** tab can — it is an editor over the real file, and the checker grades what you type
there the same way it grades what Compose produces.

**Some panels are read-only.** Config and Auth show the project facts a file resolves against; where
a value is not editable in place, `tflw.config` is a text file and editing it is the supported path.

**The page does not author across files.** Composing works on the file you have selected. A
refactor that moves a session or a hook between files is `tflw refactor`'s job, from the command
line.

## Where to go instead

| you want to | use |
|---|---|
| run in CI | `tflw run`, and the `junit.xml` it writes |
| a report to attach to a build | the `report.html` every run already produces |
| edit with full language support | the [editor extension](/editor), which is a real language server |
| try the syntax with no project | the [playground](/playground/) |
