# `@tflw/runtime` — the `parallel`/`sequential` concurrency model

This documents how `runProgram` (`src/interpreter.ts`) decides what runs concurrently and what
doesn't, once a file mixes functional `test`s and workload-bearing `test`s (Phase 2b,
`PLAN_UNIFIED_TEST_WORKLOAD.md` D99/D105-D115). There are **three independent axes** — a test never
runs in more than one of these at once, but all three apply simultaneously to a given `tflw run`:

1. **The DSL keyword** (`test "name" parallel` / `test "name" sequential`, default `sequential`) —
   a per-test declaration of whether it may batch with its neighbors. Applies equally to functional
   and workload-bearing tests, and to a batch mixing both.
2. **`--parallel N`** (CLI) — how many **files** run concurrently in this process. Orthogonal to
   the DSL keyword: it never changes what happens *inside* one file.
3. **`--workers N`** (CLI) — how many extra OS **processes** get forked to generate load, scoped to
   workload-bearing tests only (a purely functional file ignores it with a warning). Orthogonal to
   `--parallel`, but *not* fully orthogonal to the DSL keyword inside a forked process — see Table 3.

All of the outcomes below were verified against a real build (`packages/cli/dist/cli.cjs`) with
throwaway fixtures and small instrumented HTTP servers, not just read out of the source. **One real
bug was found and fixed while doing this** — see "Bug found during verification" at the bottom.

## Table 1 — one file, the DSL keyword only (no `--tag`/`--workers`)

`concurrency` batching (D109) is: walk `program.tests` in file order; a maximal run of *consecutive*
`parallel`-tagged tests forms one batch, run via `Promise.all`; anything else (a `sequential` test,
or a `parallel` test with no adjacent `parallel` neighbor) is its own singleton batch, awaited
alone. Batches themselves always run one after another, in file order.

| Test A kind | A's keyword | Test B kind | B's keyword | Adjacent in file? | Result | Works as expected? |
|---|---|---|---|---|---|---|
| functional | *(default)* sequential | functional | *(default)* sequential | yes | A fully finishes, then B starts | ✅ yes |
| functional | `parallel` | functional | `parallel` | yes | A and B run concurrently; console output for each stays contiguous (D114); report lists A then B regardless of which finished first (D112) | ✅ yes |
| functional | `parallel` | functional | sequential | yes | A is a singleton batch (no `parallel` neighbor) → runs alone, then B runs alone | ✅ yes |
| workload | *(default)* sequential | workload | *(default)* sequential | yes | A's whole ramp/hold/step/spike schedule completes, **then** B's starts | ✅ yes (was ❌ — see bug below) |
| workload | `parallel` | workload | `parallel` | yes | A and B's VU populations / arrival schedules run concurrently, sharing one batch-relative start instant | ✅ yes |
| functional | `parallel` | workload | `parallel` | yes | Both run concurrently — the functional test's single pass overlaps the workload test's whole iteration window | ✅ yes |
| workload | *(default)* sequential | functional | *(default)* sequential | yes | Workload test's iterations complete first, then the functional test runs, in declaration order | ✅ yes |
| any | `parallel` | any | `parallel` | **no** (something sequential sits between them) | Each stays its own singleton batch — the gap breaks the "consecutive" rule, so they do **not** batch together | ✅ yes |
| `with each` test (N rows) | `parallel` | any | `parallel` | yes | The row-test's own N row-cases still run strictly one after another internally; only the *whole* row-test overlaps with its batch neighbor | ✅ yes |

## Table 2 — `--tag` / `--only` / `--failed` / `--skip-workload` change *adjacency*, not just *membership*

These filters run once, up front, on `program.tests` — **before** batching happens. Batching then
sees the *filtered* list, so removing a test from the middle can make two previously-non-adjacent
`parallel` tests become adjacent, and batch together, even though they never would have in an
unfiltered run of the same file. This is a real, reproducible consequence of the current
implementation, not a hypothetical:

```
@keep
test "a" parallel     ← kept
  ...
@drop
test "b" sequential   ← removed by --tag keep
  ...
@keep
test "c" parallel     ← kept
  ...
```

| Command | "a" & "c" adjacent after filtering? | Observed | Expected? |
|---|---|---|---|
| `tflw run` (no filter, all 3 tests) | no — "b" sits between them | "a" and "c" each run alone, in order; total time ≈ 3× one request | ✅ matches file's declared shape |
| `tflw run --tag keep` (drops "b") | **yes** — "a" and "c" are now consecutive in the filtered array | "a" and "c" run **concurrently**; total time ≈ 1× one request | ⚠️ works as *implemented*, but is non-obvious — tagging a subset of a file can silently change its concurrency shape, not just which tests run |

Same mechanism applies to `--only`, `--failed`, and `--skip-workload` (`--skip-workload` drops every
workload-bearing test before batching — confirmed via
`packages/cli/test/e2e.test.ts`'s `` `tflw run --skip-workload` skips every workload-bearing test
regardless of its `parallel`/`sequential` batch `` test). **Practical implication:** if a file's
`parallel` tests are order-sensitive with respect to what sits between them, don't assume a `--tag`
subset run preserves the full file's concurrency shape — it re-derives batches from whatever
survives the filter.

## Table 3 — CLI flags × the DSL keyword

| Flag | Scope | Respects the DSL `parallel`/`sequential` keyword? | Notes |
|---|---|---|---|
| `--parallel N` (file concurrency, in-process) | Across files | N/A — operates one level up; each file's own batching runs unchanged and independently | Two files can genuinely overlap in wall time; that never changes what happens inside either one |
| `--workers 1` (default) | N/A | — | Only the main process runs; identical to Table 1 |
| `--workers N>1`, main process's own shard (shard 0) | Workload tests in this file | ✅ yes — runs through the same unified `runProgramInner` dispatch as `--workers 1` | |
| `--workers N>1`, each forked shard (shards 1..N-1) | Workload tests in this file | ✅ yes, *within that one shard's own timeline* (fixed — see below) | Each forked process independently batches its own workload subset by `parallel`/`sequential`, same rule as shard 0 |
| `--workers N>1`, **across shards** | The whole run's pooled samples | ❌ no cross-process synchronization | Shard 0 and shard 1+ are independent OS processes with no shared clock — a `sequential` pair is guaranteed not to overlap *within one shard*, but shard 0's copy of scene A can still be in flight at the same instant as shard 1's copy of scene B (or scene A). This is inherent to horizontal scaling via separate processes, not a bug: nothing in D109-D115 promises whole-run mutual exclusion, only single-process file-declared ordering. |
| `tflw run --workers N` on an all-functional file | — | N/A | No-op with a warning (`--workers` has no effect — no workload-bearing tests), file still runs |

## Bug found during verification (fixed in this pass)

**Symptom:** a `sequential` (the default) workload test declared after another workload test in the
same file got **zero iterations** — not degraded metrics, a hard zero — every time.

**Root cause:** each workload test's ramp/hold/step/spike schedule (`spawnAt` / `runEnd` in
`runScenarioTask`) is computed from `ScenarioRunCtx.runStart`. That value was stamped once, at the
very top of the whole file's run, and reused unchanged for every batch. Correct for batch 1 (whose
members start at essentially that instant, same as pre-Phase-2b `runLoadCore`, where every scenario
always started together) — wrong for batch 2 onward: a later `sequential` scenario inherited a
`runStart` already stale by however long the earlier batch took, so its entire scheduling window was
already in the past the instant it actually started.

The same unconditional-`Promise.all` shape also existed in `runLoadCore` (the engine behind both
`runLoad` and `runLoadShard`, i.e. every `--workers N>1` forked child) — it ignored the `concurrency`
field entirely, always running every workload test concurrently regardless of what the file
declared. That's the asymmetry Table 3 describes as fixed: previously, `sequential` scenarios stayed
apart in the main process but were silently raced together the moment `--workers N>1` forked any
child process, contradicting the explicit design requirement that `--workers`/`--parallel` "respect
tests' own parallel/sequential keyword."

**Fix:** both `runProgramInner` and `runLoadCore` now stamp a fresh `runStart` per batch and use
`partitionIntoBatches` to run their workload members one batch at a time, instead of one
file-global `runStart` shared across every batch. Regression tests:
`packages/runtime/test/unified-dispatch.test.ts` (`"a `sequential` workload test in the second batch
still gets its own full iteration count, not 0 (regression)"` and two neighboring tests). See
`PROGRESS.md` for the full changelog entry.
