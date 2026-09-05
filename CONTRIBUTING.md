# Contributing to tflw

Source is public and issues are welcome — **pull requests aren't accepted yet** (P#80). GitHub will show you this file when you open one anyway; that is a known cost of having the
file, and it is cheaper than not having it, because the thing this document is really for is
*working in the monorepo* — including future-me at 2am wondering what has to be green before a
branch is pushed.

**One thing this file is not: a summary.** The list of gates below is held to
`.github/workflows/` by `scripts/verify-contributing.test.mjs`, which runs inside `npm test`.
Every gate's command string is compared **exactly**, in both directions: a gate missing from this
file turns the build red, and a command this file *presents* as a gate that CI does not run turns
the build red too. If you are editing the list, edit the classification table in that file in the
same commit — otherwise one of the two will refuse.

That guard exists because this repository has already failed at this three times. The gate set used
to live in five incomplete places: this repo's `README.md`, the sibling repo's `README.md` twice,
the ledger row filed to fix the problem, and the plan written to close that row. The row omitted
`test:links`. The plan, five days later, omitted a gate that had arrived in the sibling's CI in the
meantime. Both were written by someone looking specifically for the complete list.

---

## Setup

```sh
git clone <this repo> && cd testFlow
npm install
npx playwright install --with-deps chromium firefox
```

Playwright's browsers are a separate download — `playwright` has no postinstall hook, and several
suites (`packages/cli`'s `watch`/`pick` tests, the browser-arc runtime tests) launch a **real
headed** browser. Once per clone, not per run.

**`--with-deps` here and not in CI, deliberately.** It runs `apt-get install`, and your machine may
genuinely be missing the shared libraries an engine needs; you pay that once. CI dropped it in
`M143a` because `ubuntu-latest` already carries the closure, and paying it on every job of every run
cost up to 14.5 minutes per job and cancelled nine of twelve mutation shards on run `32272901684`
with zero mutations applied. If an engine fails to launch on a runner, Playwright names the missing
library on stderr — install that one, by name, and not the closure.

Node **22 or newer** (`engines`). CI runs the suite on 22 and 24.

## The gates

CI is the gate. The two tiers below are how you avoid finding out from CI — a tier is a schedule,
not a subset of the truth.

<!-- gates:begin -->

### Triage — seconds to a few minutes, run constantly

```sh
npm run build
npm run typecheck
```

Plus, **when you have added or changed a `TF0xx` diagnostic code**, the cross-repo pair — see
[the cross-repo pair](#the-cross-repo-pair) below. It is one command and it answers in seconds.

### Before pushing — the whole set

```sh
npm run build
npm run typecheck
xvfb-run -a npm test
npm run verify:observability
npm run verify:decisions                # ※ does less in CI than it does here
npm run verify:citations
npm run verify:anchors
npm run test:links -w @tflw/docs-site
xvfb-run -a npm run coverage           # † conditional in CI
node scripts/mutate.mjs <milestone>    # ‡ the CI form is different
npm run verify:ledger                  # § never runs in CI, by decision
```

<!-- gates:end -->

**What each one is for, and the two that are not what they look like:**

- **`npm run build`** — every workspace compiles, and produces the same self-contained,
  esbuild-bundled `packages/cli/dist/cli.cjs` that `npm publish` would ship (P#43
  and 84: `build` and the publish artifact are the same thing, not two). Several gates below read
  that output, so this runs first.
- **`npm run typecheck`** — types across all seven workspaces.
- **`xvfb-run -a npm test`** — the suite *and* the headcount. The root `npm test` is
  `scripts/verify-test-counts.mjs`: it chains `test:raw` (the seven workspaces) and `test:scripts`
  (the root `scripts/` tools' own tests), then asserts each suite ran the number of tests it
  contains. **A test that never reports cannot fail**, which is what that script exists to catch —
  so *adding a test means bumping its `EXPECTED` entry in the same commit.* `xvfb-run -a` is not
  optional: without a display the headed suites **hang** rather than fail.
- **`npm run verify:observability`** — a test naming a `TF0xx` its harness cannot emit is a passing
  test of nothing. Static, seconds.
- **`npm run verify:decisions`** — **※ it does less in CI than it does here, by design.** `DECISIONS.md`
  is the resolution target for the notation this repo is written in: `P#43`, `D318`, `M137d` are
  cited roughly 730 times in tracked prose and every one of them names a block in a file
  `.gitignore` excludes. On a runner this checks the two tiers whose *both* sides are tracked — every
  cited identifier has an entry, every entry is cited, and nothing in the scrub classes reached a
  public commit — and then **prints that it skipped the third**, because the records it would
  compare against are not on the runner. Your run does all three, including the one that catches an
  entry drifting from the record it was lifted from. That tier has no CI counterpart, so a local run
  before pushing is the only thing that performs it. If it fails, the fix is in the design record and
  then `npm run docs:decisions` — never an edit between the `GENERATED:decisions` markers.
  **It is also the one gate that cannot be offloaded to the box.** `scripts/exec.mjs` syncs the
  tree without `.git/`, and this reads the tracked set through `git ls-files`, so there it fails
  with a message saying exactly that rather than a green it has not earned.
  **The index answers both repositories' prose, and since `M169d3` their code as well** (`D709`,
  `D864`). `testFlow-tests` cites this notation in documents its own readers meet, and the index used
  to publish 91 of the 185 identifiers it uses — the rest had anchors nobody had asked for. Its half
  arrives through `scripts/sibling-citations.json`, a tracked pin re-taken with
  `node scripts/refresh-sibling-citations.mjs --ref <ref>` (network, an authenticated `gh`, never CI
  — the same asymmetry `spec-anchors.json` lives with). What the pin holds is what that repository
  *asks of this one*, which is not everything it cites: its own milestones are subtracted using the
  manifest it publishes at `scripts/own-identifiers.json`, and so are the identifiers it declares
  nothing can resolve. Nothing here notices when that pin goes stale: the sibling's own
  `verify:provenance` does, in the only job in either repository with both trees checked out, so a
  cross-repo change merges **tflw first**.

  **To try a cross-repository change before pushing either half**, add `--from-checkout <path>` to
  that command (`D865`). It reads the sibling's `HEAD` from a local clone, refuses a dirty one, and
  marks the pin `local: true` — which `npm run verify:decisions` refuses outright, while generation
  proceeds with a warning. So you can see the index a change would produce and you cannot commit
  one that names a commit nobody else can fetch. Re-pin with `--ref` before committing.
  Each entry's provenance line names **files, never lines** (`D686`) — so it moves when the set of
  documents citing an identifier changes, and not when a paragraph is added above one. The line
  numbers went to **`npm run docs:provenance`**, which is not published and not tracked: per entry
  it prints the anchor that was picked with its line and form, the anchors that lost the ranking,
  and every citing site. That is the report to read when an entry looks like it was lifted from the
  wrong place — the published file names the record, but 57 identifiers have two candidate blocks
  inside the *same* record and only the report can tell you which one you are reading.
  **Since 2026-09-04 it also checks the citations in *code*,** and that half buys something
  different, so it is worth stating separately. This index answers what tracked *prose* cites; the
  notation is used just as heavily in comments, tests and `ci.yml`, and those 946 identifiers across
  525 files were checked by nothing at all. They still publish nothing. A citation in code has to
  **resolve** — the pointer must be live — and that is all: no block is lifted, no line is added
  here, and a reader who cannot see the design records is exactly as well off as before. That is
  deliberate and it is the difference between this and simply widening the corpus, which would have
  added several thousand lines to a public file in one commit. The first run found ten dead pointers
  in files a maintainer reads constantly, four of them in `ci.yml`.
  Run it alone with **`npm run docs:demand`**; `verify:decisions` runs it as part of its third tier,
  so it inherits that tier's limit exactly — it needs the records **and** `git ls-files`, so it
  cannot run in CI or on the box, and there is no CI counterpart to fall back on. It prints, every
  run, both the corpus it read and the identifiers it is declared *not* to check: six are cited
  precisely because they resolve to nothing, three of them this gate's own negative fixtures. That
  declaration is checked in the other direction too — if one of the six ever starts resolving, the
  run goes red on the declaration rather than passing quietly, because a declared non-existence that
  has become untrue is a standing exemption for a real citation.
- **`npm run verify:citations`** — the other half of that, and it runs the same in CI as it does
  here. `verify:decisions` keeps every *canonical* citation pointed at an entry; this refuses the
  older spelling, `decision 57`, which names a number without saying which of nine numbered
  sequences indexes it. A bare number is worse than an unresolvable identifier because it looks
  resolvable: 22 numbers publish both a `P#n` and a `D<n>` entry today, on unrelated subjects, so a
  reader who guesses lands on a real entry about the wrong thing. **Read the sentence, never the
  magnitude** — of the 181 identifiers `M152b` wrote into tracked prose, **37 carry a number that
  also publishes an entry in the other sequence**, so a digit-keyed rule would have sent a reader to
  a real entry about something else 37 times. Four exemptions exist and each is narrow: a citation that names its own
  record, a `tflw`/`console` fence (quoted output, not a citation), a `<script setup>` block (a
  source comment that happens to live in a `.md`), and a link target — that last one because a
  fragment like `SPEC.md#45-…-d16-d19d24ad26d70d93-d122` is an address that has to survive
  verbatim, and eight strings inside it read as citations. It reads the tracked set through `git ls-files`, so like the gate above it cannot run on
  the box.
- **`npm run verify:anchors`** — every `SPEC.md#<fragment>` a tracked file links to resolves to a
  real heading (`D677`). The failure it catches is invisible to a reader and to a link checker
  alike: GitHub does **not** 404 on a bad fragment, it serves `SPEC.md` and drops you at the top of
  3,700 lines, so a link that says §7 and lands on the title looks like the section is missing
  rather than the pointer wrong. Six were dead when this gate was written, all on user-facing pages,
  five of them for one reason — a heading writes a range with an en-dash, `(P#27–31)`, and GitHub
  deletes punctuation *before* it turns spaces into hyphens, so the anchor is `p2731` while every
  author who read the heading typed the ASCII `p27-31` they could see. **If you rename a heading in
  `SPEC.md`, this is the gate that tells you what you broke**, and it names the nearest real anchor
  rather than only the dead one. The slug rule lives in `scripts/github-slug.mjs` and is not
  trusted on its own: `scripts/spec-anchors.json` holds the anchors **GitHub itself** minted, and
  `github-slug.test.mjs` fails if the two ever disagree. Re-pin that corpus with
  `node scripts/refresh-spec-anchors.mjs --ref <branch>` — after pushing the branch, since GitHub
  can only render a ref it has. That refresh needs the network and an authenticated `gh`; only the
  comparison runs in CI.
- **`npm run test:links -w @tflw/docs-site`** — every internal docs anchor resolves and every page
  renders the sidebar it belongs to. Separate from `npm test` because it reads the **built**
  `.vitepress/dist`, so it needs `npm run build` first. This is the gate the ledger row that
  produced this file forgot to list.
- **`xvfb-run -a npm run coverage`** — **† conditional.** It gates: the floor lives in `.c8rc.json`
  (`check-coverage`) and its derivation is documented at length in `scripts/coverage.mjs`. **Do not
  lower it to make a red run green** — write the test the uncovered line is asking for. In CI it
  runs on the Node 22 leg only, since it is the same source under either runtime.
- **`node scripts/mutate.mjs <milestone>`** — **‡ the CI form is different, deliberately.** CI runs
  `--shard=i/23` across twenty-three machines, and a twenty-fourth job proves the shards' union is the
  whole registry — and, since `M148`, that the cost model those shards were packed by still describes what
  they actually cost. Locally you run the milestone you just wrote: `node scripts/mutate.mjs m98d`, or one
  mutation by id. A bare `npm run verify:mutations` runs the **entire** registry and takes tens of
  minutes. `--scope` is not a flag.

  **A demonstrated break for a product assertion means a registry entry, not a scratch sweep**
  (`M147-05`, `M147f`). `D537` says every new assertion ships with a demonstrated break, and until
  this was written it was satisfied equally by an entry here and by an ad-hoc mutation run under
  `.mNNN-scratch/` and then deleted. Those are not the same grade of evidence: a scratch sweep proves
  an assertion *could* fail once, on the day it was written, while a registry entry keeps proving it
  on every pull request under `verify:shards`' guarantee that each entry runs. Measured when the rule
  was written: **eleven consecutive milestones — `M138` through `M147b` — shipped assertions and
  added no entry**, and nothing anywhere said so. The backlog is deliberately *not* being
  reconstructed: re-deriving eleven milestones' breaks from their plans is a milestone of its own,
  and the rule earns its keep going forward. The one thing that is not optional is an instrument:
  `verify-ledger.mjs` had shipped three milestones of new checks before `M147f` aimed the first
  mutation in this repo at it.

  **A mutation's `pkg` is the suite that judges it, and it defaults to `@tflw/lang` whatever file the
  mutation names.** A mutation of `packages/runtime/src/interpreter.ts` with no `pkg:` is scored by
  the lang suite, which never runs the runtime, so it can only ever come back `SURVIVED` — and a
  false survival reads as *your assertion is weak*, which invites deleting a test that was right.
  This is `M147-09`'s shape one level out: that row was a mutation scored against the wrong *build*,
  this is one scored by the wrong *suite*. There is no gate, and deliberately so — one shipped entry
  names a different package than its file on purpose (`M147e`'s LSP anchor, where the row is an
  agreement between two surfaces and only the LSP suite reads both), so "file inside pkg" is not an
  invariant. Check it by hand when a `SURVIVED` surprises you.
- **`npm run verify:ledger`** — **§ it never runs in CI, and that is a decision.** Its corpus,
  `REVIEW_FINDINGS.md`, is gitignored on purpose, so in CI its input is simply absent — and a check
  that skips when its input is missing is green about nothing, which is the exact failure it was
  built to stop (`M131-03`). So the guard runs here, before a milestone is called done, and CI runs
  the *suite that verifies the guard* (fixture ledgers carrying known defects), folded into
  `npm test` above.

## Run the suite with `npm test`, not package by package

**Four of `packages/cli`'s test files — `e2e`, `watch`, `pick` and `lsp` — each shell out to
`npm run build` at the repo root.** Not a workspace build: the whole seven-workspace one, vitepress
included. They have to, because what they assert is a property of the shipped
`packages/cli/dist/cli.cjs`, and building it is how it comes to exist.

The only thing stopping those four from doing it *simultaneously* is `--test-concurrency=1` in that
package's `test` script. It is load-bearing and it does not look it, so:

- **Do not drop it** when narrowing an invocation. Filtering the file list is fine —
  `npm run test -w tflw -- --test-name-pattern=...` keeps the script's own flags. Retyping the
  `node --import tsx --test` line by hand does not.
- **Do not run the workspace suites concurrently.** `npm test` and `npm run test --workspaces` are
  both sequential on purpose.

**What it looks like when this goes wrong**, because it has: concurrent root builds race on the
shared `.vitepress/.temp` directory and each other's `dist/`. You get `ERR_MODULE_NOT_FOUND` on
`.vitepress/.temp/guide_*.md.js`, and — the expensive part — `@tflw/runtime` and `@tflw/lsp-server`
start failing with deep-equal diffs and reads of `undefined`, because they are importing a `dist/`
that is being rewritten underneath them. Those read exactly like product defects and are not.

Measured on 2026-08-22 at `03f6793`: a hand-rolled per-package run reported **307 failures** across
`tflw`, `@tflw/runtime` and `@tflw/lsp-server`. Those same three suites, re-run on the same machine
and the same Node through their own `npm run test -w <pkg>` scripts, reported **1582 tests and zero
failures** — and the full `npm test` reported **3574 and zero**. Nothing was fixed in between.

**The headcount is the tell, and it is cheap to read.** `scripts/verify-test-counts.mjs` knows how
many tests each suite contains, so a run that skipped or aborted one cannot hide it. That run
claimed 191 CLI tests against an expected 196, and never reached `@tflw/docs-site` (48) or the root
`scripts/` suite (162) at all. Before diagnosing a failure you did not expect, reproduce it under
`npm test` — a suite that never reported is not a suite that passed.

## The cross-repo pair

**A tflw milestone that assigns a `TF0xx` code is not done until its companion PR in
[testFlow-tests](../testFlow-tests) has merged too.** That repo's CI re-packs tflw from its live
`main` — unpinned on purpose, since pinning would kill the dogfooding exactly when it matters — so
a new code with no fixture there turns *its* `main` red. The two PRs are one unit of work and merge
back-to-back, tflw first.

The command that catches this in seconds, before either PR exists, lives with the repo where it
fails: **[`testFlow-tests/CONTRIBUTING.md`](../testFlow-tests/CONTRIBUTING.md)**. It is documented
there and deliberately not copied here — two homes for one command become one correct home and one
stale one, which is the failure mode this whole document was written to end.

## Where these actually run — and the part nothing checks

> **This section is not guarded.** Everything above is held to `.github/workflows/`. The setup
> described here has no CI counterpart to be compared against, so it can go stale and nothing will
> say so. Treat it as orientation, not as a contract.

The full set is minutes of compute, and on this project it runs on a Fedora box over SSH rather
than on the laptop, through `scripts/exec.mjs`:

```
node scripts/exec.mjs test          # sync → lock → npm test on the box
node scripts/exec.mjs exec -- <cmd> # any command in the repo root, same lock, same tree
node scripts/exec.mjs status        # both machines: node, load, memory, lock holder
```

**That file is untracked, by decision (`D14`), and a fresh clone will not have it.** It encodes one
person's two-machine setup — an SSH alias, a lock path, a remote directory layout — none of which is
true for anyone else. Without it, run the gates locally and pay the wall-clock; nothing above needs
the box.

Two traps it is worth writing down, both of which have cost a real debugging session:

- **`testFlow-tests` has its own `scripts/exec.mjs`, and your working directory decides which one
  runs** — and therefore which copy on the box. Driving the wrong one produces `MODULE_NOT_FOUND`
  for a script that plainly exists.
- **A trailing `| tail` makes the pipeline's exit status `tail`'s.** The shell reports success while
  the log says the run failed. Read the log, not the summary line.

The box is shared with other work and takes a whole-machine lock; a busy box is waited on, never
worked around.

## Writing a docs page

> **Not guarded, deliberately** — it is authoring advice, not a gate. What *is* guarded is the
> result: `npm test -w @tflw/docs-site` and `npm run test:links -w @tflw/docs-site` fail on every
> mistake below, which is why these are traps rather than rules.

- **Read a heading id out of the built HTML. Never derive it from the heading text.** VitePress's
  slugifier is not the one you would write: it **keeps `—`** and **drops `…`**, so
  `## Scaling across processes — \`--workers N\`` becomes `#scaling-across-processes-—-workers-n`,
  and `## \`csrf from … send as header\` — a token that travels with the credential` drops the
  ellipsis and keeps the dash. Deriving one by eye failed **four times across `M149c`–`M149e`**,
  every time in the same confident direction. `npm run build -w @tflw/docs-site` then
  `grep -o 'id="[^"]*"' .vitepress/dist/guide/<page>.html` answers it in one command.
- **A shipped construct needs a page, and it is matched on its syntax, not its name.**
  `verify-docs.mjs` takes the set difference between `specConstructs()` — one manifest, all 178
  constructs, less the 66 diagnostics `diagnosticsCoverage.test.ts` already holds (`D790`/`D791`) —
  and every code string on the site, and fails on a construct that appears nowhere (`M149f`/`D659`).
  What counts as a mention is the construct's own `syntax` cell, so `close tab` is coverage of
  `close` and `close()` is not (`D792`); write the construct the way the manifest spells it. The
  config keys carry no syntax cell, so they match on `slot` + `id` and **only inside a `tflw-config`
  fence** (`D837`) — eight of the sixteen are words the step dialect also uses. If something is
  deliberately undocumented, say so in `DECLARED_UNDOCUMENTED` with the reason; if it is legitimately
  future, that is `DECLARED_ROADMAP` and a different guard.
- **One citation classifier, and it lives in `scripts/citation-rules.mjs`.** The private notation
  (`M158`, `D105`, `P#75`, `A3-05`) does not belong on a page a tflw user reads (`D673`), and the
  rule that spots it is imported by the docs-site guard rather than duplicated there (`D794`/`D795`).
  Widening a shape-based rule to `/i` is a red test, not a preference: GitHub lowercases its heading
  anchors, so case is the only thing separating `SPEC.md#45-retries-d105-` from a citation.
- **A `tflw-config fragment` is completed with a fixture env, so it has to nest.** `authorized
  target` at the top level of a fragment is `TF022` — put it under `defaults` (or an `env`), the way
  a real config carries it.
- **Fence tags are a taxonomy, not decoration.** An untagged or unknown fence fails the run rather
  than being skipped (`DT-01`). `tflw` is a whole file, `tflw fragment` is steps to wrap in a test,
  and `binds=a,b` declares the variables a fragment interpolates but never captures.

## Before parking a claim on "this needs a real editor"

> **This section is not guarded either**, and it is deliberately outside the gate region above.

The editor surfaces are far more reachable from a shell than they look, and assuming otherwise has
now cost two findings that sat parked for milestones before anybody checked. `B5-06` — an unsaved
buffer silently getting no language support at all — carried that excuse for four milestones and
then reproduced *in seconds* in a test file written for exactly this purpose. It happened again at
`M106-01`, where three of the four shapes the claim named answered over stdio.

Two ways in, neither of which needs a display:

- **In-process.** `packages/lsp-server/test/protocol.test.ts` drives `startServer()` over the real
  wire protocol — initialize, open a document, read the `publishDiagnostics` it pushes back, ask for
  hover, semantic tokens or a rename. This is where a diagnostic's *position* and a server's
  *behaviour* are settled.
- **The shipped binary.** `node packages/cli/dist/cli.cjs lsp` speaks the same protocol on stdio, so
  a handful of `Content-Length`-framed messages from a script answers the same questions against the
  artifact a user actually installs. Worth using when the question is whether the CLI and the LSP
  agree — they have disagreed.

What genuinely needs a running Extension Host is **client-side wiring and presentation**: activation
events, language-id association, whether a colour is the one you meant. That set is smaller than it
first looks, and `packages/vscode/test/MANUAL.md` is the checklist for what is left of it — no
automated test in this repo has ever started a real Extension Host (`M136b-02`).

So the question is not *"is this an editor thing?"* but **"which half of this is protocol and which
is presentation?"** Park the presentation half if you must; the protocol half is measurable today,
and a claim parked whole is a claim nobody measured.

## Running from a clone

Using `tflw` from a checkout without publishing to npm, or embedding it in another local project
without a registry: see
[Getting started](https://deepak-tuteja.github.io/tflw/getting-started#using-tflw-from-a-checkout-no-npm-registry-needed).
