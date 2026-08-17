// M135a (PLAN_M135_SARIF.md D409) — the three packs' id tuples against the packs themselves.
//
// **What the type system already does, and where it stops.** Each descriptor's `id` is narrowed to
// its pack's tuple, so a rule cannot be declared with an id the tuple does not contain, and the
// remediation KB is `Record<ScanRuleId, KbEntry>`, so an id cannot be added to a tuple without an
// entry appearing for it. Those two together are the chain D409 wanted: new rule → tuple → KB, all
// enforced at build time.
//
// The direction neither can see is a **surplus** id: a tuple entry for a rule that was renamed,
// merged or deleted. Nothing fails to compile, and the visible consequence is a KB entry nobody can
// reach and — after `M135b` — a `rules[]` catalog and a `tflw/notApplicable` list describing a rule
// that can never fire. That reads to a consumer as *a check we run and that never triggers*, which
// is the exact three-state confusion this arc has now spent two milestones separating.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTHZ_RULES, AUTHZ_RULE_IDS } from '../src/authzRules.js';
import { INPUT_RULES } from '../src/inputRules.js';
import { INPUT_RULE_IDS } from '../src/inputCorpus.js';
import { SECURITY_RULES, SECURITY_RULE_IDS } from '../src/securityRules.js';
import { SCAN_RULE_IDS } from '../src/scanRuleIds.js';

test('each pack declares exactly the ids its tuple lists', () => {
  assert.deepEqual([...SECURITY_RULE_IDS].sort(), SECURITY_RULES.map((r) => r.id).sort());
  assert.deepEqual([...AUTHZ_RULE_IDS].sort(), AUTHZ_RULES.map((r) => r.id).sort());
  assert.deepEqual(Object.values(INPUT_RULE_IDS).sort(), INPUT_RULES.map((r) => r.id).sort());
});

test('the tuples are ordered as their packs are', () => {
  // Not cosmetic: `SECURITY_RULE_IDS` is severity-descending because `SECURITY_RULES` is, and
  // `M135b` builds SARIF's `rules[]` catalog from the tuple. A catalog ordered differently from the
  // pack makes two runs of one suite produce documents that diff for no reason anyone can act on.
  assert.deepEqual([...SECURITY_RULE_IDS], SECURITY_RULES.map((r) => r.id));
  assert.deepEqual([...AUTHZ_RULE_IDS], AUTHZ_RULES.map((r) => r.id));
});

test('SCAN_RULE_IDS is the three packs joined, with no duplicates', () => {
  assert.equal(SCAN_RULE_IDS.length, 19, 'twelve hygiene, three authorization (M137b added `sec/csrf-not-enforced`), four input-handling');
  assert.equal(new Set(SCAN_RULE_IDS).size, SCAN_RULE_IDS.length, 'two packs sharing an id would give one KB entry two meanings');
  assert.deepEqual(
    [...SCAN_RULE_IDS],
    [...SECURITY_RULE_IDS, ...AUTHZ_RULE_IDS, ...Object.values(INPUT_RULE_IDS)],
    'scan order — hygiene, authorization, input-handling — is the order the three scans shipped in and the order the census prints',
  );
});

test('every id is `sec/`-prefixed', () => {
  // The prefix is what keeps a tflw finding legible next to an axe-core rule id in the same report,
  // and after `M135b` it is also what a SARIF consumer sees as the `ruleId`.
  for (const id of SCAN_RULE_IDS) assert.match(id, /^sec\/[a-z0-9-]+$/, `${id} is not a well-formed rule id`);
});
