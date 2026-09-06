import type { AuthorizedTarget } from '../../src/types.js';

/**
 * `M173d1` — one `authorized target` declaration, with all four `probe*` opt-ins stated.
 *
 * `AuthorizedTarget`'s four opt-ins are **required booleans** (`types.ts:30`), and twenty-one
 * fixtures across four files here named at most one of them. Every consumer filters on
 * truthiness, so an absent field and an explicit `false` behave identically — which is exactly
 * why nothing was visibly wrong, and exactly what `M155-01` says the unchecked half hides. The
 * type says a declaration states its position on all four; these fixtures stated a position on
 * none.
 *
 * **The default is `false` on all four, and that is the semantic default, not a convenience.**
 * Each opt-in is a *grant* — `probe mutating`, `probe oversized`, `probe traversal`,
 * `probe ciphers` — and a declaration that does not say the words has not granted the thing. A
 * builder defaulting these to `true` would hand every fixture a permission its source text never
 * wrote, which is the one direction a security opt-in must never drift.
 *
 * Deliberately a **sibling** of `packages/reporter/test/cli-summary.test.ts`'s `authorized`, not a
 * shared module: the two live in different workspaces, and a test helper exported across a package
 * boundary is a published surface. The duplication is six lines and the reason is one sentence.
 */
export function authorized(target: string, reason: string, granted: Partial<AuthorizedTarget> = {}): AuthorizedTarget {
  return {
    target,
    reason,
    probeMutating: false,
    probeOversized: false,
    probeTraversal: false,
    probeCiphers: false,
    ...granted,
  };
}
