# Working on the page

```sh
npx tflw ui            # serves the project in this directory, prints a URL with its token
npx tflw ui --port 4700
```

The URL is the only way in: it carries a token minted for this start, and the page refuses a
request without it. It serves on loopback only; `ssh -L 4700:127.0.0.1:4700` reaches it from
another machine, and the pasted URL carries the token.

## Writing

**Compose** writes tests, hooks, actions and crawls through forms. **Source** is an editor over the
file itself — highlighting, the checker's answer underlined as you type, undo, and completion: start
typing a step, a subject, a matcher or a session name and the list is the one the editor extension
offers at the same position. **Ctrl+Space** asks for it where nothing is typed yet; **Enter** takes
the highlighted entry.

**⌘S** (Ctrl+S) writes the draft. Compose and Source are two views of one draft, so either saves
what both show. A file changed on disk since the page read it is refused, not overwritten — reopen
it and apply the edit again.

**Config** is the same editor over `tflw.config`: sessions, envs, `authorized target`.

## Running

**▶** beside a test runs that test; the Run tab runs the selection with the env, workers and
`--headed` shown on it. A run started here is an ordinary `tflw run`: it writes `report/` and keeps
itself under `report/runs/<id>/`, and the dots beside each test are its last kept runs.

## Accessibility

The page announces a run starting, a run ending and a file saved through one polite status region,
and moves nothing on screen for a reader whose system asks for reduced motion. Every control is
reachable by keyboard; in the editor, **Tab** indents — press **Escape** first to move focus on.

## When something is wrong

| you see | it means |
|---|---|
| *the file changed under this page* | another editor wrote it after the page read it — reopen it |
| a squiggle with a `TF0xx` code | what `tflw check` will say about these bytes; saving is not blocked |
| a test with no dots | it has no kept run yet — run it once |
| the page refuses to load | the URL is from an earlier start — each start mints a new token; use the one just printed |
