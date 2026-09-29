# RUNBOOK

The maintainer's runbook. `M253` writes the rest of this file; `M252` `D` opens it with the one
table that cannot wait for it.

## Flakes

A flake is a CI failure that a re-run of the same commit turns green. **It is logged here at first
sight, and filed as an S4 row in `REVIEW_FINDINGS.md` at the second** (`D1375`). Logging costs one
line; not logging is how a failure seen twice reads as seen once.

One row per sighting — a second sighting of the same test is a second row, and the one that files
it. Both repositories' flakes go here, because both are read by the same maintainer.

| Date | Repo | Job | Test | Run | Filed |
|---|---|---|---|---|---|
| 2026-09-27 | tflw | build + typecheck + test (Windows, Node 22) | cli `ui-page.test.ts` — `M223` `E`: with a trace up, the playback height is the reader's. `EBUSY` removing the test's temp directory: Windows held a file the browser had just closed | [36346955425](https://github.com/deepak-tuteja/tflw/actions/runs/36346955425/job/108697864473) | — |
| 2026-09-27 | tflw | build + typecheck + test (Windows, Node 22) | runtime — *a uniformly fast server does not trigger a backOff warning* | [36321744249](https://github.com/deepak-tuteja/tflw/actions/runs/36321744249/job/108626789608) | — |
| 2026-09-29 | tflw-tests | regression (tooling) | `construct-acceptance` C45 `step:hold` recall 6/7 — a 150 ms run read 84% of a core and still reported `saturated: false`: a CPU-share reading on a shared runner | [36578578234](https://github.com/deepak-tuteja/tflw-tests/actions/runs/36578578234/job/109441293308) (tflw-tests#126) | `M252-01` |
| 2026-09-29 | tflw-tests | regression (tooling) | `construct-acceptance` C45 again, on `main` — 89% of a core. The second sighting: filed, and fixed in tflw-tests#130 by making the plant's CPU a busy wait rather than startup cost | [36592291328](https://github.com/deepak-tuteja/tflw-tests/actions/runs/36592291328/job/109488408989) | `M252-01` |
