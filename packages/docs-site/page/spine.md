# The spine

Every surface past the landing is the same three things in the same places: the **files** down the
left, the **door bar** across the top, and the **tab strip** over whichever file you picked. Learn
it once and nothing else on the page needs learning.

![The shell: the file list, the door bar, the tab strip, and a file open on Source](/page/spine-paper.png){.light-only}
![The shell: the file list, the door bar, the tab strip, and a file open on Source](/page/spine-terminal.png){.dark-only}

## The file list

Every `.tflw` file the project holds, in directory order, each with a count of the tests behind the
current door. A file that does not parse is listed with its diagnostics and counted nowhere — an
unparsed file has no honest number to contribute, so it contributes none rather than an
approximation.

Picking a file changes what the tabs show. It never changes the door.

## The door bar

The four doors, and the same counts the landing showed. Switching doors changes which tests the
file list counts and what a new test would be scaffolded as. It does **not** filter the files, and
it does not decide what a test may contain: a test that carries a workload shows its workload panel
behind every door, because a panel is earned by what the test says and not granted by the way you
came in.

The door lives in the address bar, so a door is shareable and survives a reload.

## The five tabs

A tab is a stage of one file's life, or a project fact that file resolves against. It never changes
which file you are looking at.

| tab | what it shows |
|---|---|
| **Source** | the file itself — and, while you are composing, the bytes the write will produce |
| **Compose** | the request and the assertions that read it, as a form |
| **Run** | what happened when this project last ran |
| **Auth** | who this file's tests run as, and what they are permitted to reach |
| **Config** | `tflw.config` — the project facts every file here resolves against |

Source, Compose and Run are the three stages: read it, write it, run it. Auth and Config are the
second clause — they are project-scoped whichever file is selected, and they are here because a
file's meaning depends on them.

There is deliberately no *History*, no *Docs* and no *Coverage* tab. None of those is a stage of a
file's life or a fact it resolves against, so none of them is a tab.

## Themes

The page ships four themes, and they differ in type, density and shape as much as in colour. The
pictures throughout this section are two of them — **Terminal**, the default, and **Paper**, the
light one — and which you see follows this site's own appearance setting.

The choice is remembered in your browser and nowhere else. It is not written to the project, so it
cannot show up in a diff.
