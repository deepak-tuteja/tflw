# Manual verification — the page under VoiceOver

`ui-page.test.ts` proves the page hands a screen reader the right structure: a polite status
region in the DOM from the first render (`D1365`), names on every control, `aria-describedby` on a
control while its tip is shown, no transition outside `prefers-reduced-motion: no-preference`. It
cannot prove a screen reader **says** any of it, because nothing in CI runs one. This runcard is that
half. It is run by a person, once per milestone that changes the page, on a Mac with VoiceOver.

The `P#n`/`D<n>`/`M<n>` citations below name blocks in design records this repository does not
publish; each resolves in [DECISIONS.md](https://github.com/deepak-tuteja/tflw/blob/main/DECISIONS.md).

## How to run the page for real

From a real project — one with a `tflw.config` and a few `.tflw` files; `examples/storefront` in
this repository works, and so does `testFlow-tests`:

```sh
npm run build            # in this repository, so the page is this working copy's
node <this repo>/packages/cli/dist/cli.cjs ui
```

Open the printed URL in Safari (VoiceOver's best-supported browser), then turn VoiceOver on with
**Cmd+F5**. Use the VoiceOver keys (**Ctrl+Option**, "VO") for everything below; do not use the mouse
except where a check says so.

## The checklist

**Finding your way**

1. **VO+U → Landmarks** lists the page's regions by name. Moving to each one says what it holds.
2. The door bar (API · Browser · Load · Scan) reads as tabs, says which one is selected, and moves
   with the arrow keys once focused.
3. The file tree reads each file by name, and opening one moves the reading position to it — not to
   the top of the page.

**Writing**

4. In Source, the editor is announced as an editable text area named *the file's source*.
5. Type `  ex` on a new line under a `test`: the completion list is announced, with the highlighted
   entry's word (**expect**) and its description. Down arrow moves and reads the next entry; Enter
   inserts it and the list is announced as gone.
6. With the list closed, **Escape** then **Tab** leaves the editor. Tab alone indents (the language
   is indentation), so the Escape is required — confirm the page never traps focus inside it.
7. Press **Cmd+S** with an unsaved edit: VoiceOver says **"saved \<file\>"** without the reading
   position moving.

**Running**

8. Start a run from the Run tab: VoiceOver says **"the run started"**, and when it ends, **"the run
   passed"** (or *failed*, *cancelled*) — once each, without the reading position moving.
9. Start a run and move to another tab before it ends: the ending is said once, and the notice that
   also appears is not read a second time over it.

**Descriptions**

10. Focus a control that has a tip (the ▶ beside a test, a door's icon): its name is read, then its
    description. Tab away and back: the description is read again — it describes the control, not
    whatever the pointer last touched (`M235-06`).

**Motion**

11. **System Settings → Accessibility → Display → Reduce motion** on. Start a run: the running dot
    is lit and does not pulse. Turn it off: it pulses again.

## Log it

Record the result in `REVIEW_FINDINGS.md` under the milestone that changed the page, one row per
check that fails, family `ui:a11y` — including "did not run" when it did not. A check nobody ever
performs is the failure this runcard exists to prevent.
