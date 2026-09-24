// `M237` `A1` — a teardown that cannot run before the setup it tears down.
//
// ## The mechanism, measured rather than reasoned about
//
// When `--test-name-pattern` selects **zero** tests, `node:test` runs the root `after()` hook
// **without awaiting the root `before()` hook**. Measured on the box at Node v22.22.0 on
// 2026-09-24, with a probe whose `before()` sleeps 1200 ms and then opens a listening socket:
//
//     zero-match:   B start -> A ran, server is UNDEFINED -> A done -> B end, listening -> rc=124
//     unfiltered:   B start -> B end, listening -> T ran -> A ran, server is defined -> rc=0
//
// Both halves of the two open ledger rows fall out of that one ordering:
//
//   * `M236-03`, the crash. `after()` reads a binding `before()` has not assigned yet, so
//     `rm(undefined)` / `undefined.close()` throws out of the teardown and the WHOLE FILE is
//     reported `hookFailed` in half a millisecond, naming a path argument rather than the setup
//     that never ran.
//   * `M235-02`, the hang. `before()` then carries on and finishes opening its handles — with the
//     only code that would ever have closed them already run and gone. `M108` removed
//     `--test-force-exit` on purpose, so the process hangs, honestly, forever.
//
// ## Why the guard that was already tried is not the repair
//
// `M235` `A1b` repaired `ui-page.test.ts` by guarding each teardown call against an unassigned
// binding (`browser?.close()`, `if (scratch !== undefined)`) on the diagnosis — written into that
// file's own `after()` docblock, into `scripts/flake-box.sh`'s header, and into `M235-02` — that
// **`before()` is never run when zero tests are selected**. It is run. The guard therefore makes
// every teardown call a silent no-op instead of a throw, and the handles `before()` goes on to
// open are leaked exactly as before: that file is the one census entry that hangs with **no**
// `hookFailed` and a 15-byte log reading only `TAP version 13`. A loud failure became a quiet one.
//
// ## What this does instead
//
// The setup body is started ONCE and its promise is kept, so the teardown can wait for the same
// promise the hook returned. `before()` still returns it, so a setup that throws still fails the
// file exactly as it did. `settled()` swallows the rejection deliberately: by the time teardown
// runs, that failure has already been reported, and re-throwing it there would replace the
// original diagnosis with a second copy of itself.
//
// THE GUARDS IN THE TEARDOWNS STAY, AND THEY ARE NOT THIS REPAIR. `settled()` answers the
// ordering; a binding can still be unassigned when `bring` itself throws partway, and an
// `undefined.close()` there would bury the setup's own diagnosis under a second failure naming an
// argument. That is `M236-03`'s complaint verbatim, so the guard is kept as what it always should
// have been — the thing that keeps a FAILED setup legible, not the thing that makes a filtered run
// correct.
//
// Registration stays in the calling file. A helper that called `before`/`after` itself would be
// registering hooks on a context it does not own from a module the runner never sees, and this
// round has already spent a day on one claim about the runner that nobody had run.
//
// `M134a-01` is why this is one module and not eleven copies of the paragraph above: two files
// describing one arrangement drift, and the three files that disagreed about `before()` are the
// standing proof of it in this repository.

/**
 * Split a root `before()` body into a hook and a promise the matching `after()` can wait for.
 *
 * @param {() => Promise<void>} bring the setup body, exactly as it read inside `before()`
 * @returns {{ begin: () => Promise<void>, settled: () => Promise<void> }}
 *   `begin` is the `before()` hook; `settled` resolves once `bring` has finished, however it
 *   finished, and resolves immediately if `begin` was never called at all.
 */
export function stagedSetup(bring) {
  let setup;
  return {
    begin: () => (setup = bring()),
    settled: () => (setup === undefined ? Promise.resolve() : setup.then(noop, noop)),
  };
}

function noop() {}
