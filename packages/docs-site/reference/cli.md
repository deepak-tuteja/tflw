---
title: CLI flags reference
---

<script setup>
import { CLI_FLAGS } from '../../lang/src/spec-data.ts';
// `code()` turns spec-data.ts's markdown inline-code spans into <code> tags for the plain HTML
// table below; it is one shared module because it used to be four identical copies (`M110b-02`).
import { code } from '../.vitepress/mdCode.ts';
const runFlags = CLI_FLAGS.filter((f) => f.command === 'run');
const checkFlags = CLI_FLAGS.filter((f) => f.command === 'check');
const initFlags = CLI_FLAGS.filter((f) => f.command === 'init');
const installFlags = CLI_FLAGS.filter((f) => f.command === 'install-browsers');
const pickFlags = CLI_FLAGS.filter((f) => f.command === 'pick');
const watchFlags = CLI_FLAGS.filter((f) => f.command === 'watch');
const migrateFlags = CLI_FLAGS.filter((f) => f.command === 'migrate');
const fmtFlags = CLI_FLAGS.filter((f) => f.command === 'fmt');
const uiFlags = CLI_FLAGS.filter((f) => f.command === 'ui');
const specFlags = CLI_FLAGS.filter((f) => f.command === 'spec');
const globalFlags = CLI_FLAGS.filter((f) => f.command === 'global');
</script>

# CLI flags reference

Generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts)
(this table used to live in README.md — it moved here as part of the docs-site cluster). For the full prose description of each subcommand, see
[SPEC.md §12](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#12-cli-).

Every subcommand the shipped `tflw` binary dispatches has a section on this page, and
`verify-docs.mjs` fails the build if one is added without one.

```sh
npx tflw run --env staging --parallel 4 --seed 42 --now 2026-01-01T00:00:00.000Z --no-color
```

## `tflw run`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in runFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

`tflw run` drives functional and workload-bearing `test`s alike in one pass — a `test` becomes
workload-bearing the moment it contains a `ramp`/`hold`/`step`/`spike`/`run … iterations` line (see
the [load testing guide](/guide/load-testing)); there's no separate `load` command (folded into
`run`). `parallel`/`sequential` (a test-header modifier, not a flag) controls which tests in
a file run concurrently with each other; `--workers N` is the unrelated, workload-only axis above —
it scales *one* workload-bearing test's own generated load across `N` forked processes, never files.
Every run with at least one workload-bearing test also self-diagnoses its own generator process's
event-loop lag/CPU and warns if tflw itself was the bottleneck. A live ~1Hz console line tracks
iterations/rps/error-rate for the workload-bearing tests currently in flight; Ctrl-C stops new
iterations and flushes a **partial** report instead of losing the run. Everything — functional and
workload-bearing test results alike — renders into the one `report/report.html`/`junit.xml`/
`results.json`, in file-declaration order; there are no separate `load-*` artifacts. Exit `0`
= every test passed and every `threshold` was met (or none declared), `1` = a test failed or a
threshold was breached, `2` = usage error, `3` = **inconclusive** (a workload-bearing test ran and
tflw's own generator process saturated — the numbers describe tflw contending with itself, not the
system under test; every threshold's junit `<testcase>` comes back `skipped`, not passed/failed),
`130` = aborted via Ctrl-C (the standard "died from SIGINT" code).

::: tip A flag that takes a value must be given one
`tflw run --evidence` with nothing after it — or with another `--flag` in the value slot — exits
`2` with a usage error rather than quietly falling back to the default. That default is `full`,
the least protective evidence level, so a flag that lost its argument to a CI YAML fold used to
produce a full-detail artifact and a green pipeline. Use `--flag=value` for a value that really
does start with `--`.
:::

::: warning An empty value is not "no filter"
`--tag ""` and `--tag=` exit `2` as well. An empty value asks for *nothing*, so tflw refuses it
rather than running everything: `--tag` and `--only` narrow a run, and an empty one used to be
indistinguishable from leaving the flag off — widening the run to the whole suite, at exit `0`,
while `--tag nope` correctly failed. You will not type this by hand; a shell writes it for you,
from `tflw run --tag "$SUITE_TAGS"` with the variable unset. A value made only of separators
(`--tag=,,`) names no tags and is refused for the same reason.
:::

## `tflw check`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in checkFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Validate-only: the same parse + checker pipeline `run` executes before it does anything, with no
HTTP traffic and no secrets required. Exit `0` when every file is clean, `2` otherwise.

## `tflw init`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in initFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Scaffolds `tflw.config`, `example.tflw`, `.env.example`, and a `.gitignore` covering `.env` and
`report/` — appending to an existing `.gitignore` rather than duplicating entries.

## `tflw install-browsers`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in installFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

One-time browser binary download for UI steps — `playwright` is an optional peer, so this only
works once the consuming project installs it.

## `tflw pick <url>`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in pickFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Opens a real, visible browser at `<url>` and prints one verified locator per click; runs until the
window is closed or Ctrl+C. `<url>` must be absolute — no `tflw.config` involved.

## `tflw watch`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in watchFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

`tflw watch [files] [--env E] [--seed S] [--browser engine] [--no-color]` re-runs headed on every
save, one shared browser window for the whole session; saving `tflw.config` re-runs everything.
Runs until Ctrl+C.

## `tflw migrate [files]`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in migrateFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Mechanically rewrites checker-flagged deprecations in place, then prints which files changed. Three
rules carry a rewrite today — `scenario` → `test`, `think` → `pause`, `uncheck` → `untick`.

**How to tell whether migrate can fix something: the diagnostic says so.** Any diagnostic that ends
with `= fix: run `tflw migrate` to apply this automatically` is one it can act on. That line is
derived from the rewrite itself rather than written next to each rule, so the offer and the
capability cannot drift apart.

**Bare `check <locator>` is deliberately not one of them.** It has two honest readings —
`tick field "…"` (the old click) and `check field "…" is checked` (the assertion) — and guessing
wrong turns an assertion into a mutation in a test that keeps passing. Migrate reports each one and
leaves it to you; on the real migration this was built against, that was 5 of 7 sites.

**It works on files that do not parse**, which is the only kind it exists for. It splices what it
can, writes, re-checks the rewritten source, and prints whatever remains against the *new* line
numbers — repeating until a pass finds nothing left, since a `think` nested inside a `scenario` is
invisible to the parser until the `scenario` is fixed. Exit **0** if the suite is clean afterwards,
**2** if errors remain, including when it did rewrite something and the file still fails: migrate's
job is the rewrite, not the verdict.

It rewrites *keywords*, not prose. A migrated file can be entirely correct code and still name the
old keyword in its comments and `test "…"` names — this is not a rename-symbol refactor.

## `tflw fmt [paths]`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in fmtFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Formats `.tflw` files in place. A path may be a file or a directory; a directory is walked for
`.tflw` files (`node_modules/`, `.git/` and `report/` are skipped — a repro tflw wrote into
`report/` is not something you meant to format); no path means the current directory. Each file
that changed is named, then one summary line.

**What it decides, and what it never touches.** Blocks indent two spaces per level. On a line,
tokens are separated by one space, with none before `,` `:` `)` `]` and none after `(` `[`; objects
are padded `{ a: 1 }`, arrays are `[1, 2]`, an interpolation `{name}` stays tight (that is the
language's own rule: `{ IDENT }` is an interpolation and an object always has a `key:`). A
multi-line `body { … }` indents its content one level past the line that opened it and puts the
closer back at that line's indent. Data tables align by column. Blank lines collapse to one,
trailing whitespace goes, the file ends in exactly one newline. **Comments never move**: a comment
line stays a line, at the indentation of the code that follows it (or of the block it closes, when
it sits at the end of one); a trailing comment gets two spaces before its `#`; comment text is
never edited. Strings, numbers, paths and everything else inside a token are emitted byte for byte.

Three spaces are kept as you wrote them, because the same two tokens mean two things and only the
parser tells them apart: the space after a `-`/`+` (`price: -1` against `today - 10 days`), the
space between a number and the word after it (`4s` is a duration, `3 seconds` is one too, `4 s` is
an error), and the space between a name and a `[` (`body[0]` is an index, `equals [1, 2]` is a
list).

**A file that does not lex is not formatted.** It is named on stderr with the diagnostic, left
byte-for-byte alone, and the command exits 1 — a formatter that silently skips a broken file is a
check that says "clean" about a file it never read. Fix the file (`tflw check` says how), then
format it.

**The guarantee.** For every file it writes, the formatted text lexes to the same tokens in the
same order (indentation and comments excluded), keeps every comment in text and order, keeps the
block structure, and formats to itself on a second pass. That property is what lets the rules be
this opinionated: nothing the formatter does can change what a file means. The same function
answers the editor's *Format Document* through `tflw lsp`, so format-on-save in VS Code needs no
setting beyond the extension.

## `tflw ui [dir]`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in uiFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Serves the page for a directory — the one holding `tflw.config`, the current one by default — on
`127.0.0.1` and prints the URL. **A directory with no `tflw.config` opens too**, as a blank
project: the page says so and offers to create one, which runs `tflw init` for you. What is
refused is a path that is not a directory at all, because that is a typo rather than a new
project. The page is a projection of the project and of its report
directory, never a second copy of either: it lists the discovered files and the tests in them, it
starts a run as `tflw run --format ndjson` (the same command, the same files, the same report
directory a terminal run writes) and relays the stream as it arrives, and it opens every report
directory the project holds — the current one, and each run started from the page, which is kept
aside as `report/runs/<id>/` when it ends.

**The page can also author a test**, through one write route with one call site: a form per door
previews the exact bytes it is about to write and `tflw check` judges them before the write, the
file on disk is the only truth, and `tflw.config` is not reachable through that route. The forms
and what each door scaffolds are not documented here yet.

**The project's configuration is edited in its own tab, through its own route.** Every door's
*Config* tab is a plain editor over `tflw.config` — the bytes you type are the bytes written, and
nothing reformats them — refusing only text that does not parse, and writing under the version the
page read so a file changed by a terminal in the meantime is reported rather than overwritten. It
is a separate capability from the one above and not a widening of it: the test-writing route still
refuses this file.

**That tab is multi-document once the config declares one.** A `baseline` declaration names a second
file the project owns, so the tab carries a switcher — `tflw.config` first, then one entry per
declared document, labelled with its path and the block that declares it — and each document is
addressed in the URL, which is what lets a link point at one line of one of them. They are the same
editor under the same rules, with one difference the file itself dictates: a declared baseline that
has not been written yet opens as an empty document rather than an error, because that is where
every project adopting triage starts, and the config's diagnostics are not applied to a file that is
not in the config dialect. Beside it, *Auth* reads what that configuration means for the file you are
looking at — which sessions its tests run as and what each adds to a request, the built-in
`anonymous` principal, and every `authorized target` in force with its reason and what each
`probe` opt-in grants.

**What a browser test shows is what the report holds.** At `evidence full` the screenshots a run
took are on the page and a failed test's Playwright trace opens in Playwright's own trace viewer,
which `tflw ui` serves under `/trace/` from the project's `playwright-core` — nothing is spawned
and the archive never leaves the machine. Below `full` there is no screenshot and no trace, by
decision, and the page says so under each browser test rather than leaving a gap.

**A workload test is its metrics, charted.** The figures are `results.json`'s own — iterations,
failures, error rate, the all-iterations and the successful-only percentiles, every threshold with
its actual, one row per endpoint — in the units the console and `report.html` print. The four
charts are the report's per-second timeline (latency p50/p95/p99, throughput, error rate) and its
bucketed histogram; hover a chart and the legend reads that second's own numbers. Two runs compare
by opening two report directories: pick one under *compare with* and every table gains the other
run's column and the signed difference, and every chart its dashed series.

**A security scan is its findings, grouped by rule.** The block above the tests is
`results.json`'s `findings` in the order the console and `report.html` use — gating first, then
withheld, worst severity first — each with its endpoint, its source line, its fingerprint, the
gate's verdict (*known/accepted* for a baselined finding, which stays on the page rather than
vanishing) and the same *possible fixes* entry `report.html` carries. *Which rules ran* lists what
applied and what stood down, with the reasons. With a second run open under *compare with*, each
finding says whether the other run had it and with what verdict, and the other run's findings this
one lacks are listed — the baseline diff, drawn from two reports.

**A finding can be accepted from the page, and accepting it writes nothing.** Each gating finding
that carries a fingerprint has an `[accept]` link: it resolves which baseline document a run under
this report's env grades against — the env's own block, or the `defaults` one it falls back to —
splices the entry into that document in the shape `--baseline-write` emits, and opens the *Config*
tab on the line it added. The document is then unsaved text in an editor, and stays that way until
somebody saves it. An acceptance is an affirmation about the application under test that only its
author can make, so the page stages it and shows it; it does not make it. A document it cannot
splice honestly — not JSON, no `accepted` array, or already carrying this fingerprint — is returned
unchanged and opened anyway, and an env with no `baseline` declared is refused with the reason. See
[Findings, baselines & the gate](/guide/findings-and-baselines) for the workflow this belongs to.

**A run's exit is stated where its report cannot state it.** `tflw run`'s exit codes 0, 1, 3 and
130 are the report's own verdicts (passed, a failure, inconclusive, aborted) and the header carries
them; anything else — a process that died after writing its report, a signal, a cancel from the
page — is written above the report with the run's stderr, and a run that wrote no report at all
(a refused argument, an unmet `require env`) keeps a row of its own in the run list rather than
disappearing. The environment a page-started run sees is the server's: start `tflw ui` where a
terminal run would work, with the same `.env` beside the config.

**Loopback only.** The bind address is not configurable: the page can start a run, and a run reads
the project's `.env`. To reach it from another machine, tunnel it (`ssh -L 4141:127.0.0.1:4141`
to that machine) rather than exposing it.

## `tflw docs [topic]`

Prints one section of the SPEC as a terminal cheatsheet; with no topic, lists every section name.
Takes no flags. The content is a static artifact regenerated from `SPEC.md` at build time rather
than parsed at run time — `SPEC.md` itself is not shipped in the npm package.

## `tflw spec [--json]`

Prints the construct manifest of *this build*: every declaration, step keyword, matcher, generator,
locator, `tflw.config` word and diagnostic code the parser dispatches, followed by a build stamp —
version, commit and build time.

It exists for conformance testing. A suite that wants to prove it exercises the whole language has
to be able to ask what the whole language is, and reading it out of `@tflw/lang` is not available to
a consumer who installed the published `tflw` package: that ships one self-contained bundle with no
`@tflw/*` packages to import. `--json` is the form such a gate reads.

The manifest lists **what this binary dispatches, and only that**. A construct SPEC marks 🔮 planned
is absent rather than listed as planned, so building one makes it *appear* — which is what lets a
downstream coverage gate go red on its own the day it ships, with nobody having to remember.

Declarations are the outermost family: the seven words a file can begin a top-level block with
(`test`, `crawl`, `action`, `import`, `use`, `before`, `after`) and the five clauses a `test` header
takes (`tags`, `with each`, `as`, `retry`, `parallel`/`sequential`). A hook's two scopes are one
construct with two forms, the same way `switch to new tab` and `switch to tab N` are one `switch`.

The build stamp is the other half. `commit` is a short sha, or `null` where there was no git to ask
(a published tarball, a vendored checkout) — never invented, because an invented one would be
believed. `dirty` says whether the working tree had uncommitted changes, and is `null` when there is
no commit for it to be relative to. Together they answer *which tflw just produced this output*,
which is the question a stale vendored copy makes unanswerable.

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in specFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

## `tflw lsp`

Runs the [language server](/editor) over stdio. Takes no flags and is not meant to be typed by
hand: stdin and stdout carry the LSP wire protocol, so an editor spawns it. `packages/vscode` does
exactly this; any other LSP-capable editor can point at `npx tflw lsp`. Diagnostics come from the
same `checkProgram` pass list `tflw check` runs, so an editor squiggle and a CI failure are the
same computation.

## `tflw refactor apply <id>`

Extracts one reuse-pass hint (an `RF0xx` id from `tflw check`'s output) into a shared `action`,
writing a new file and rewriting every matched call site. Takes exactly one positional argument —
no flags — and always scans the whole default suite (no `[files]`/`--env` selection, since the
hint ids it consumes come from that same whole-suite scan). Re-run `tflw check`/`tflw run`
afterward to confirm the rewritten suite is still clean and green.

## Global

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in globalFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>
