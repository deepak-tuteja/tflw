# RUNBOOK

The maintainer's runbook: where the work runs, how a change is closed out and merged, what the
gates are called, and what publishing will be. [`CONTRIBUTING.md`](CONTRIBUTING.md) is what a
contributor needs and is held to CI; this page is the operating half, and most of it is not
guarded by anything, so it says so where it matters. The adopter's runbook — how to run *a
project* — is [the docs site's](https://deepak-tuteja.github.io/tflw/runbook/project).

## The box

Tests do not run on the laptop. Everything that runs a suite — `npm test`, coverage, the
screenshots, the sibling's sweep — runs on the Fedora box over SSH, through `scripts/exec.mjs`,
which is untracked by decision (`D14`) and exists only in this setup:

```sh
node scripts/exec.mjs test            # sync this repo → take the box's lock → npm test
node scripts/exec.mjs exec -- <cmd>   # any command at the repo root, same lock, same synced tree
node scripts/exec.mjs status          # both machines, and who holds the lock
```

- **Each repository's `exec.mjs` syncs only that repository.** A sibling change reaches the box
  through the sibling's own `exec.mjs`, run from its own directory.
- **`exec -- bash -c '…'` loses its quoting.** Call the command directly, from the repo root, with
  repo-relative paths.
- **A command that ends in a pipeline reports the pipeline's exit status**, so a red run can print
  a green line. Read the log.
- **An SSH failure means stop and ask** — never run the suite on the laptop instead. A busy box is
  waited on.
- Browser suites need a display: `xvfb-run -a npm test`, `xvfb-run -a npm run coverage`.

## Closing out a milestone

1. Build every slice, then one batched box run (`xvfb-run -a npm test`); the first run after a new
   test fails on headcount pins in `scripts/verify-test-counts.mjs`, not on findings — each pin
   moves with a note saying why.
2. Any change to the CLI, the page's server, the page or `DECISIONS.md` re-cuts the docs' pictures:
   `node --import tsx packages/ui/scripts/make-screenshots.mjs` on the box, then copy
   `packages/docs-site/public/ui/` back. The manifest reddens until you do.
3. The sibling's sweep against **this** build (`M195`, `D1023`), with the build named:
   `TFLW_BIN=../testFlow/packages/cli/dist/cli.cjs npm run regression --prefix ../testFlow-tests`,
   on the box, four groups at once with `--parallel-groups`.
4. `CHANGELOG.md` and the milestone's docs page land with it (`D1350`); `DECISIONS.md` is
   regenerated (`npm run docs:decisions`) whenever a new decision is cited.

## Merging a pair

tflw first, then the sibling (`D511`), for the reason `CONTRIBUTING.md`'s *The cross-repo pair*
gives. Between the two merges the sibling's `main` is red; that window is accepted.

- **tflw PRs rebase-merge. The sibling's PRs merge with a merge commit, never a squash (`D1397`).**
  tflw pins a commit of the sibling's PR branch (`node scripts/refresh-sibling-citations.mjs
  --pr <N>`), and a squash leaves it outside the sibling's history: `verify:sibling-pin` goes red
  with *not an ancestor*.
- A sibling branch that cites a tflw decision not yet on tflw's `main` declares it pending
  (`DECLARED_PENDING` in its `scripts/verify-provenance.mjs`, `D943`); the entry is dropped in the
  commit before the sibling PR merges.
- A stacked PR retargeted after its last push gets no CI run: close and reopen it.
- `gh` names the sibling `deepak-tuteja/tflw-tests`.

## The gates, by name

`npm test` is the whole set, and CI runs exactly it; the list of what it runs and what each gate
proves is `CONTRIBUTING.md`'s *Before pushing*. The ones a maintainer reaches for by name:

| gate | what it holds |
|---|---|
| `verify:decisions` | every cited `D`/`M`/`P#` resolves in `DECISIONS.md`; `docs:decisions` regenerates it |
| `verify:citations` | a citation in shipped code or prose has the shape that resolves |
| `verify:sibling-pin` | the sibling commit tflw pins is in the history of the ref it names |
| `verify:check-coverage` | every check-phase `TF0xx` code has a fixture in the sibling |
| `verify:coverage-floors` | the per-package floors in `coverage-floors.json` are derived as stated |
| `verify:settled-reads` | the page's reads that must settle before a screenshot or an assertion |
| `verify:ledger` | `REVIEW_FINDINGS.md`'s rows are well-formed |

**Coverage.** `xvfb-run -a npm run coverage` gates each package against its floor in
`coverage-floors.json`, pinned one point under its measured value. Do not lower a floor to make a red
run green — write the test the uncovered line is asking for. When a floor is missed by a function
nobody wrote, diff the `coverage-lcov` artifact of `main`'s last green run against the branch's:
a callback the source map names (`name.name`) is a function too.

## Flakes

A flake is a CI failure that a re-run of the same commit turns green. **It is logged here at first
sight, and filed as an S4 row in `REVIEW_FINDINGS.md` at the second** (`D1375`). Logging costs one
line; not logging is how a failure seen twice reads as seen once.

One row per sighting — a second sighting of the same test is a second row, and the one that files
it. Both repositories' flakes go here, because both are read by the same maintainer.

| Date | Repo | Job | Test | Run | Filed |
|---|---|---|---|---|---|
| 2026-09-27 | tflw | build + typecheck + test (Windows, Node 22) | cli `ui-page.test.ts` — `M223` `E`: with a trace up, the playback height is the reader's. `EBUSY` removing the test's temp directory: Windows held a file the browser had just closed | [36346955425](https://github.com/deepak-tuteja/tflw/actions/runs/36346955425/job/108697864473) | `M252-02` |
| 2026-09-27 | tflw | build + typecheck + test (Windows, Node 22) | runtime — *a uniformly fast server does not trigger a backOff warning* | [36321744249](https://github.com/deepak-tuteja/tflw/actions/runs/36321744249/job/108626789608) | — |
| 2026-09-29 | tflw-tests | regression (tooling) | `construct-acceptance` C45 `step:hold` recall 6/7 — a 150 ms run read 84% of a core and still reported `saturated: false`: a CPU-share reading on a shared runner | [36578578234](https://github.com/deepak-tuteja/tflw-tests/actions/runs/36578578234/job/109441293308) (tflw-tests#126) | `M252-01` |
| 2026-09-29 | tflw-tests | regression (tooling) | `construct-acceptance` C45 again, on `main` — 89% of a core. The second sighting: filed, and fixed in tflw-tests#130 by making the plant's CPU a busy wait rather than startup cost | [36592291328](https://github.com/deepak-tuteja/tflw-tests/actions/runs/36592291328/job/109488408989) | `M252-01` |
| 2026-09-29 | tflw | build + typecheck + test (Windows, Node 22) | cli `ui-page.test.ts` — `M213` `S5`: a recording writes statements into the test it was started on. `EBUSY` removing its temp directory: the same cause as the 2026-09-27 row, in another test — filed, and fixed with `rm`'s own retry | [36615058174](https://github.com/deepak-tuteja/tflw/actions/runs/36615058174/job/109565836286) (tflw#262) | `M252-02` |

## Publish day

Nothing is published before the owner's word (`D1379`): not npm, not the Marketplace, not Open
VSX, not the Action's repository, not a `.vsix` on a release. When the word comes, it is this list,
in order, from a workstation:

1. `packages/cli/package.json`: `"private": false`; `pack.test.ts` is updated to match.
2. `npm publish -w tflw` — the version is `1.0.0`.
3. `npx @vscode/vsce publish --no-dependencies` in `packages/vscode`, and
   `npx ovsx publish` with the same `.vsix` (the release's, from `release-vsix.yml`).
4. The Action: `.github/action/` pushed to its own repository and tagged `v1`.
5. The docs site's `PUBLISHED` flag flipped, so the install pages lead with `npm install -D tflw`.
6. `git tag v1.0.0` and push the tag.
