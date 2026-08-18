// How an `authorized target`'s granted `probe …` sub-clauses read in an artifact (M134a, D372) —
// one definition, shared by the CLI summary and `report.html`, following this package's existing
// one-module-per-formatting-concern shape (`threshold-format.ts`, `workload-format.ts`).
//
// **It exists because of what D291 put the reason in the artifact for.** The declaration is an
// author affirming in writing what this run was permitted to send, and the artifact is where that
// claim is auditable. A summary that named two of three opt-ins would understate the permission —
// and it would understate it invisibly, to exactly the reader the line exists for.
//
// So the list is derived from a table rather than written out at each call site, and the table is
// typed so that a fourth sub-clause is a **compile error** until somebody gives it a word here. That
// is the same completeness rule `SCAN_MATCHER_NAMES` uses in the parser, and it is what stops this
// file being the one that quietly falls a milestone behind — which is precisely what `M133` found
// had happened to two editor wordlists over four milestones.

import type { AuthorizedTarget } from '@tflw/runtime';

/** Every boolean opt-in on the declaration, in the order they are written under it. Keyed on the
 * field so the mapping cannot drift from the AST, and `satisfies` makes the record total: adding
 * `probeSomething` to `AuthorizedTarget` fails this file until it is given a word. */
const PROBE_CLAUSE_WORDS = {
  probeMutating: 'probe mutating',
  probeOversized: 'probe oversized',
  probeTraversal: 'probe traversal',
  probeCiphers: 'probe ciphers',
} satisfies Record<Exclude<keyof AuthorizedTarget, 'target' | 'reason'>, string>;

/** The sub-clauses this declaration granted, in declaration order. Empty when it granted none —
 * the common case, and the one where the caller prints nothing rather than an empty bracket. */
export function grantedProbeClauses(target: AuthorizedTarget): string[] {
  return Object.entries(PROBE_CLAUSE_WORDS)
    .filter(([field]) => target[field as keyof typeof PROBE_CLAUSE_WORDS])
    .map(([, word]) => word);
}
