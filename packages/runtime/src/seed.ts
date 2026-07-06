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

/** Per-test sub-seed derived from the run seed + test index, so parallel/worker order never
 * shifts generated values (P#23) — a cheap deterministic combine, not a second PRNG draw. */
export function subSeed(runSeed: number, index: number): number {
  return (runSeed ^ Math.imul(index + 0x9e3779b9, 2654435761)) >>> 0;
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
