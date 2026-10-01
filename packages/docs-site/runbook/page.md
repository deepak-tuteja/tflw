# Working on the page

The reference companion to [7. The page](/runbook/start/page): the keys, what each part does, and
what its messages mean. For a picture of every surface, see [The UI](/ui/).

```sh
npx tflw ui            # serves the project in this directory, prints a URL with its token
npx tflw ui --port 4700
```

The URL is the only way in: it carries a token minted for this start, and the page refuses a
request without it. It serves on loopback only; `ssh -L 4700:127.0.0.1:4700` reaches it from
another machine, and the pasted URL carries the token.

## Writing

The header, the file list and the three tabs are the same on every file: [the spine](/ui/spine).
The kind chips over the list filter it and ▶ by what each test is about: [the four kinds](/ui/kinds).

**Compose** writes tests, hooks, actions and crawls in place: pick a row and it becomes its own
editor. Each row of a test has **↑** and
**↓** to move it one place (**Alt+↑**/**Alt+↓** on a focused row); a request moves with the
assertions under it, those assertions move among themselves, and nothing moves out of its own
test, hook or request. **Source** is an editor over the
file itself — highlighting, the checker's answer underlined as you type, undo, and completion: start
typing a step, a subject, a matcher or a session name and the list is the one the editor extension
offers at the same position. **Ctrl+Space** asks for it where nothing is typed yet; **Enter** takes
the highlighted entry.

**⌘S** (Ctrl+S) writes the draft. Compose and Source are two views of one draft, so either saves
what both show. A file changed on disk since the page read it is refused, not overwritten — **re-read
from disk** beside the refusal shows the file as it is now, and drops the draft.

**Config** is the same editor over `tflw.config`: sessions, envs, `authorized target`.

What Compose offers depends on the test: a request and its assertions in an [API test](/ui/api),
the steps a person takes in a [BROWSER test](/ui/browser), the plan panel a workload earns in a
[LOAD test](/ui/load), and the targets block of a [scan](/ui/scans).

## Running

**▶** beside a test runs that test; **▶** in the header runs what the file list shows, with the env
beside it and `workers` and `--headed` under **more…** when the run can spend them. A run started here is an ordinary `tflw run`: it writes `report/` and
keeps itself under `report/runs/<id>/`, and the dots beside each test are its last kept runs. While it
runs, the file you are on shows it — each step's mark lands on its row, a line under the file's name
says how far it has got and offers **cancel**, and the right-hand column follows the step it has
reached. The **Run** tab reads a run as a tree by verdict, failures first; see [Reading a
run](/ui/a-run). A `tflw run` started from a terminal in the same project shows on the Run tab while
it runs, too — it says so in `report/.running.json` until it has kept itself; the page cannot cancel
a run it did not start.

## Accessibility

The page announces a run starting, a run ending and a file saved through one polite status region,
and moves nothing on screen for a reader whose system asks for reduced motion. Every control is
reachable by keyboard; in the editor, **Tab** indents — press **Escape** first to move focus on.

## When something is wrong

Some things the page does not do on purpose; [What it will not do](/ui/limits) lists them.

| you see | it means |
|---|---|
| *the file changed on disk since this page read it* | another editor wrote it after the page read it, and nothing was written — **re-read from disk** shows the file as it is now and drops your draft, so copy anything you want to keep first |
| a squiggle with a `TF0xx` code | what `tflw check` will say about these bytes; saving is not blocked |
| a test with no dots | it has no kept run yet — run it once |
| the page refuses to load | the URL is from an earlier start — each start mints a new token; use the one just printed |
