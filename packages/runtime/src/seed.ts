// Deterministic seeded PRNG for `random`/`unique` generators (P#19, P#23). Not cryptographic —
// this buys test-data reproducibility (`--seed` replay), not security.

/** mulberry32 — small, fast, good-enough statistical quality for generated test data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Domain separators for `subSeed` (`M154g-15`, `D815`). An index only means something inside the
 * space it was minted for, and this function was being handed indices from two unrelated spaces —
 * a *test index* and the *`unique` counter* — with no way to tell them apart. The consequence was
 * not a wrong-looking value but a predictable one: `unique uuid`'s k-th draw derived its
 * random-looking half from exactly the stream test k's `random` draws from, so an unrelated test
 * could be used to predict it. Two callers, two domains, no shared space.
 *
 * `test` is `0` **on purpose**: it keeps the historical derivation bit-for-bit, so adding this
 * parameter moves `unique uuid` alone and leaves every test's `random` stream replaying exactly as
 * it did before under the same `--seed`. A domain separator that renumbered both spaces would have
 * been the tidier constant and the worse change. */
export const SEED_DOMAIN = {
  /** A test's own `rng`, keyed by its global test index. The historical (and only) caller. */
  test: 0,
  /** `unique uuid`'s local shape RNG, keyed by the run-wide `unique` counter. */
  uniqueUuid: 0x753d,
  /** `unique like`'s per-pattern permutation, keyed by the run namespace (`D930`, `M181a`). A third
   * space again: the index handed in there is a *run identity*, not a test index and not a counter,
   * and `D815` exists precisely so that a new caller declares its space instead of borrowing one. */
  uniqueLike: 0x4c9b,
} as const;

/** Per-test sub-seed derived from the run seed + test index, so parallel/worker order never
 * shifts generated values (P#23) — a cheap deterministic combine, not a second PRNG draw.
 *
 * `domain` (`D815`) separates callers that index *different* things into this one function; see
 * `SEED_DOMAIN`. It defaults to `SEED_DOMAIN.test` (`0`), which is the identity for the mixing step
 * below, so the pre-`M161` derivation is preserved exactly for that caller. */
export function subSeed(runSeed: number, index: number, domain: number = SEED_DOMAIN.test): number {
  const base = (runSeed ^ Math.imul(index + 0x9e3779b9, 2654435761)) >>> 0;
  return domain === 0 ? base : (base ^ Math.imul(domain + 0x85ebca6b, 0xc2b2ae35)) >>> 0;
}

/** The active run seed: `--seed <n>` if given, else a fresh one (stamped in the report/CLI
 * summary so a failing run can be reproduced exactly with `tflw run --seed <n>`). */
export function resolveRunSeed(explicit?: number): number {
  if (explicit !== undefined) return explicit >>> 0;
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** The active run clock: `--now <iso>` if given, else the real current instant — captured once
 * per run and threaded through `EvalCtx` so `today`/`now`/`random date in past`/`in future`
 * derive from it instead of a fresh `Date.now()` at each evaluation (P#23, decision 52). `--seed`
 * alone reproduces *which* relative values a run draws (which offset, which choice); it does not
 * anchor those draws to the same wall-clock instant across separate invocations — `--seed` +
 * `--now` together do. Assumes `explicitIso` was already validated (mirrors `resolveRunSeed`'s
 * contract: validation is the caller's job, e.g. the CLI's usage-error checks, P#46). */
export function resolveRunClock(explicitIso?: string): Date {
  return explicitIso === undefined ? new Date() : new Date(explicitIso);
}

/** FNV-1a 32-bit — a stable string→int hash, used to derive a `session`'s own sub-seed from its
 * name (P#42, decision 53) independent of which racing test's `TestCtx` happened to trigger it
 * first under `--workers N>1`. Not cryptographic; only needs to be stable and well-distributed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Width of the run namespace (`D929`, `M181a`) — 30 bits, and the number is set by the narrowest
 * member rather than by the widest. `unique uuid` carries the namespace in the four bytes that
 * begin at the variant nibble, and the variant claims two of those 32 bits; `unique number` carries
 * it in a JavaScript safe integer, whose remaining 23 bits are that generator's per-run capacity.
 * One width for the whole family is what lets SPEC §7.2 state one cross-run promise instead of
 * five. */
export const RUN_NAMESPACE_BITS = 30;
const RUN_NAMESPACE_MODULUS = 2 ** RUN_NAMESPACE_BITS;

/** The run namespace (`D929`) — the identity of *this invocation*, mixed into every `unique` value
 * so a second run against a database the first run already wrote to does not re-issue the first
 * run's values. `M162-01`: thirteen API tests degraded on a second run against one live stack, and
 * twelve of the thirteen were one column, because `user<counter>@example.test` restarts at `user0`
 * on every `tflw run` while `user.email` outlives the run.
 *
 * It comes from the run **clock**, and never from the run seed. `--seed` means *replay the RNG*,
 * and the whole contract of the `unique` family is that it never consults the RNG at all
 * (`M154g-07`, and the `C81`/`C82`/`C113` clauses that define `unique` *by* its seed-independence):
 * keying this off the seed would make `--seed N` re-issue the same emails on every run, which is
 * the defect measured above wearing a flag. `--now` is already the documented way to pin the clock
 * (§7.4), so an exactly-reproducible run stays available through the flag that already means it.
 *
 * Truncated to `RUN_NAMESPACE_BITS`, so two runs share a namespace only when their clocks differ by
 * an exact multiple of 2^30 ms (12.4 days) — a statement about clocks, not a probability. Total by
 * construction: an invalid `--now` is the CLI's usage error to refuse (`resolveRunClock`'s stated
 * contract), and a `NaN` here would not fail anywhere a reader would look — it would render the
 * literal text `NaN` into every generated value and go on passing. */
export function resolveRunNamespace(runClock: Date): number {
  const ms = runClock.getTime();
  if (!Number.isFinite(ms)) return 0;
  return (((ms % RUN_NAMESPACE_MODULUS) + RUN_NAMESPACE_MODULUS) % RUN_NAMESPACE_MODULUS) >>> 0;
}

/** The run namespace as it appears inside a generated *string* — fixed-width base36, so
 * `user-<token>-<counter>` is injective in `(namespace, counter)` by construction rather than by a
 * separator convention that a future prefix could contain. Six digits is exactly what 30 bits needs
 * (36^5 < 2^30 < 36^6), and the width is padded rather than natural so it never varies. */
export function runNamespaceToken(namespace: number): string {
  return namespace.toString(36).padStart(6, '0');
}
