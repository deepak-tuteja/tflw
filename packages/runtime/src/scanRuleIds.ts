// M135a (PLAN_M135_SARIF.md D409) — the three rule packs' ids, joined.
//
// **Why this is its own module and not a line in `scanFindings.ts`.** `scanFindings.ts` is the
// report boundary: it takes a generic `Finding` from whichever pack produced it and knows nothing
// about which packs exist, which is the property that let D385 wire three producers to one gate
// without any of them importing another. Naming all three packs there would give the boundary a
// dependency on its own producers. This module is allowed to know all three because knowing all
// three is the entirety of its job.
//
// **What the union buys.** `@tflw/reporter`'s remediation KB is `Record<ScanRuleId, KbEntry>`, so
// the chain from a new rule to its remediation is closed by the compiler: a rule cannot be declared
// with an id outside its pack's tuple (each descriptor's `id` is narrowed to it), and an id cannot
// be added to a tuple without the KB gaining an entry. D409 rejected a conformance test for this
// precisely because a test only catches the ids it knows how to enumerate, which is the same
// problem the union solves once, at build time, for nothing.

import { AUTHZ_RULE_IDS, type AuthzRuleId } from './authzRules.js';
import { INPUT_RULE_IDS, type InputRuleId } from './inputCorpus.js';
import { SECURITY_RULE_IDS, type SecurityRuleId } from './securityRules.js';

/** Every rule id that can appear in a `ScanFinding.rule`, across all three scans. */
export type ScanRuleId = SecurityRuleId | AuthzRuleId | InputRuleId;

/**
 * The same set as a value, in scan order — hygiene, authorization, input-handling — which is the
 * order the three scans shipped in and the order the report's census prints them in.
 *
 * `INPUT_RULE_IDS` is an object rather than a tuple (it predates this milestone and its keys are
 * used as named references throughout `inputCorpus.ts`), so its values are spread rather than the
 * container itself. The result is still exhaustive: the union is derived from the same three
 * sources, so a member missing here would be a member missing from the type.
 */
export const SCAN_RULE_IDS: readonly ScanRuleId[] = [...SECURITY_RULE_IDS, ...AUTHZ_RULE_IDS, ...Object.values(INPUT_RULE_IDS)];
