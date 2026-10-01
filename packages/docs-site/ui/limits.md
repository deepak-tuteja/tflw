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

**It keeps nothing on the server.** No database, no sidecar file, no hidden directory. Which file,
which tab and which chip you are on live in the address bar, so a link is shareable and a reload changes
nothing. Three conveniences live in your browser and nowhere else: your theme, whether it is
compact, and the last file you had open, per project — so a bare address opens where you left it. Everything else is the project on disk, which means the page can be closed at
any moment without losing anything that was not already a file.

**It does not lint your taste.** The page will happily show you a passing test that asserts nothing.
A verdict is about what ran, and the page reports it faithfully rather than editorialising.

**It is local, and it is yours.** `tflw ui` serves on the loopback interface for the person who
started it, and the URL it prints carries a token minted for that start — the page opens from that
URL and from nothing else, every request from the page carries the token, and a request from any
other page in your browser, or with a `Host` that is not loopback, is refused. There is no login
because there is nothing to log into: one process, one token, one person. Making it remotely
reachable is not something the command offers; `ssh -L` forwards the port and the URL you paste
carries the token with it.

**It is for a desktop.** The page is laid out for a window 900 px wide and up — the explorer, a
test's steps, and what came back, side by side. Below 1100 px what came back folds under the picked
row; below 900 the page stacks, and nothing is designed for a phone.

## Not yet

**Sessions and envs are written in Config, not in a form.** Compose writes tests, hooks, actions
and crawls, one line at a time in place, and anything its rows do not cover the **Source** tab edits directly — an editor over
the real file, with the language's own highlighting, the checker's answer underlined as you type,
undo, and the language's own completion as you type. The two things a file resolves against rather than holds, `session` and `env` blocks,
live in `tflw.config`, and the Config tab is the same editor over that file. A second, form-shaped
editor over one file would be two answers to one question.

**Auth is read-only.** It shows the sessions and targets a file resolves against, and each row
links to the line in Config that declares it.

**The page does not move a test, hook or action between files.** Composing works on the file you have
selected. The page moves, renames and deletes whole files, shows what each would change first, and
rewrites every `import` that names them; moving one session, hook or action from one file to
another is an edit in each file, made in Source or Config. The one cross-file rewrite tflw makes
for you is extracting a repeated run of steps into a shared action: `tflw check` names each one as
an `RF0xx` hint, and `tflw refactor apply <id>` writes it, from the command line.

## Where to go instead

| you want to | use |
|---|---|
| run in CI | `tflw run`, and the `junit.xml` it writes |
| a report to attach to a build | the `report.html` every run already produces |
| edit with full language support | the [editor extension](/editor), which is a real language server |
| try the syntax with no project | the [playground](/playground/) |
