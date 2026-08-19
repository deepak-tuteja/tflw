# Contributing to tflw

Source is public and issues are welcome — **pull requests aren't accepted yet** (PLAN.md decision
80). GitHub will show you this file when you open one anyway; that is a known cost of having the
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
npm run test:links -w @tflw/docs-site
xvfb-run -a npm run coverage           # † conditional in CI
node scripts/mutate.mjs <milestone>    # ‡ the CI form is different
npm run verify:ledger                  # § never runs in CI, by decision
```

<!-- gates:end -->

**What each one is for, and the two that are not what they look like:**

- **`npm run build`** — every workspace compiles, and produces the same self-contained,
  esbuild-bundled `packages/cli/dist/cli.cjs` that `npm publish` would ship (PLAN.md decisions 43
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
- **`npm run test:links -w @tflw/docs-site`** — every internal docs anchor resolves and every page
  renders the sidebar it belongs to. Separate from `npm test` because it reads the **built**
  `.vitepress/dist`, so it needs `npm run build` first. This is the gate the ledger row that
  produced this file forgot to list.
- **`xvfb-run -a npm run coverage`** — **† conditional.** It gates: the floor lives in `.c8rc.json`
  (`check-coverage`) and its derivation is documented at length in `scripts/coverage.mjs`. **Do not
  lower it to make a red run green** — write the test the uncovered line is asking for. In CI it
  runs on the Node 22 leg only, since it is the same source under either runtime.
- **`node scripts/mutate.mjs <milestone>`** — **‡ the CI form is different, deliberately.** CI runs
  `--shard=i/12` across twelve machines, and a thirteenth job proves the shards' union is the whole
  registry. Locally you run the milestone you just wrote: `node scripts/mutate.mjs m98d`, or one
  mutation by id. A bare `npm run verify:mutations` runs the **entire** registry and takes tens of
  minutes. `--scope` is not a flag.
- **`npm run verify:ledger`** — **§ it never runs in CI, and that is a decision.** Its corpus,
  `REVIEW_FINDINGS.md`, is gitignored on purpose, so in CI its input is simply absent — and a check
  that skips when its input is missing is green about nothing, which is the exact failure it was
  built to stop (`M131-03`). So the guard runs here, before a milestone is called done, and CI runs
  the *suite that verifies the guard* (fixture ledgers carrying known defects), folded into
  `npm test` above.

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
