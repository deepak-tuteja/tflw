// M97a (`PLAN_M97_CHECKER_CONTRACT.md`, D138) — the guard that makes `RUNTIME_RULES` a ledger
// rather than a snapshot of one afternoon's triage.
//
// `conformance.ts` claims to enumerate every rule the runtime enforces. Nothing would keep that true:
// a `throw new RuntimeError(...)` added next month is a new rule with no row, and the manifest would
// go on *looking* complete. That is the identical failure mode `diagnosticsCoverage.test.ts` (M86)
// closed between `Codes` and `DIAGNOSTICS`, and `grammarCoverage.test.ts` (M78) closed between the
// parser's keywords and GRAMMAR.md. This is the third instance of one shape, and the M97 plan is
// explicit that noticing the shape is the point: nobody writes a wrong row, they forget to write one.
//
// The scan is a regex over TypeScript, with a paren-balancing walk so multi-line constructions come
// out whole. Accepted deliberately (D138): its failure mode is a *false alarm* — an unrecognised
// site fails this test until someone classifies it — and never a false pass. The alternative,
// threading a rule id through all 104 `RuntimeError` constructions, is a far larger diff than this
// cluster warrants.
//
// Matching is by message excerpt, never by line number. M96 moved five of the sites the M97 plan
// cites by 7-39 lines apiece; a line-keyed manifest would have been stale before it was written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { Codes } from '../src/index.js';
import { RUNTIME_RULES } from '../src/conformance.js';

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_SRC = join(here, '../../runtime/src');
/**
 * The constructor names a throw site can carry. `RuntimeError` plus every class in the runtime that
 * extends it, **derived rather than listed** (M143b).
 *
 * It was the bare string `'throw new RuntimeError('` for six milestones, which made every subclass
 * a hole: `AllowHostsError` (5 sites) and `RedirectLimitError` (4) had been outside the classified
 * corpus since they were introduced, and nothing said so — the completeness test cannot report a
 * site it never collected. `M143b` found it by *moving* two classified sites into the hole (a
 * request timeout became `RequestTimeoutError` so `wait until api` could tell it apart by type
 * instead of by matching its text), at which point the other direction of the guard — a row
 * matching zero sites — fired. That is the direction working; the corpus shrinking silently is not.
 *
 * Derived from the source, so the next subclass joins the corpus by existing rather than by
 * somebody remembering this constant. A subclass whose sites are unclassified now fails loudly,
 * which is the whole point of a completeness check.
 */
function throwNeedles(): string[] {
  const names = new Set(['RuntimeError']);
  for (const file of sourceFiles(RUNTIME_SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/class\s+(\w+)\s+extends\s+RuntimeError\b/g)) names.add(m[1]!);
  }
  return [...names].map((n) => `throw new ${n}(`);
}

interface Site {
  file: string;
  line: number;
  text: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * Backticks are escaped inside template literals (`` \` ``) and bare inside single-quoted strings,
 * so the same message is written two ways depending on which quote the author reached for. Collapse
 * that difference — and runs of whitespace, for multi-line constructions — so an excerpt can be
 * written once, the way a reader would say it.
 */
function normalize(text: string): string {
  return text.replace(/\\`/g, '`').replace(/\s+/g, ' ').trim();
}

/** Every `throw new <RuntimeError or subclass>(...)` under packages/runtime/src, argument text included. */
function runtimeThrowSites(): Site[] {
  const sites: Site[] = [];
  const needles = throwNeedles();
  for (const file of sourceFiles(RUNTIME_SRC).sort()) {
    const text = readFileSync(file, 'utf8');
    for (const NEEDLE of needles) {
    let idx = 0;
    while ((idx = text.indexOf(NEEDLE, idx)) !== -1) {
      const open = idx + NEEDLE.length - 1;
      let depth = 0;
      let end = open;
      for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      sites.push({
        file: relative(RUNTIME_SRC, file),
        line: text.slice(0, idx).split('\n').length,
        text: normalize(text.slice(open + 1, end)),
      });
      idx = end;
    }
    }
  }
  return sites;
}

const SITES = runtimeThrowSites();
const matchesRule = (site: Site, rule: { excerpt: string; exact?: boolean }) =>
  rule.exact ? site.text === normalize(rule.excerpt) : site.text.includes(normalize(rule.excerpt));

test('the scan finds throw sites at all — a scan that matches nothing would pass every test below', () => {
  // Without this, a regression in `runtimeThrowSites` (a renamed directory, a changed constructor
  // name) turns every assertion here into a vacuous pass over an empty list. That is precisely the
  // failure this file exists to prevent, so it is worth one assertion at the top.
  assert.ok(SITES.length > 90, `expected the runtime to throw RuntimeError in many places, found ${SITES.length}`);
  assert.ok(
    new Set(SITES.map((s) => s.file)).size > 5,
    'expected sites across many files — if this collapses to one, the directory walk broke',
  );
});

test('every runtime throw site is described by a `RUNTIME_RULES` row', () => {
  const unclassified = SITES.filter((site) => !RUNTIME_RULES.some((rule) => matchesRule(site, rule))).map(
    (s) => `${s.file}:${s.line} — ${s.text.slice(0, 100)}`,
  );
  assert.deepEqual(
    unclassified,
    [],
    'these runtime rules are enforced but unclassified. Add a row to RUNTIME_RULES in conformance.ts saying whether the checker can decide it (D137 clause 2) — and if it can, either wire it up or file the row',
  );
});

test('every `RUNTIME_RULES` row still matches the number of sites it claims', () => {
  // The other direction: a rule deleted from the runtime leaves a row describing a rule that is no
  // longer enforced, which reads as coverage. `sites` is asserted exactly, not as a floor, so
  // splitting one throw into two also lands here rather than passing quietly.
  const wrong = RUNTIME_RULES.map((rule) => {
    const hits = SITES.filter((site) => matchesRule(site, rule));
    const expected = rule.sites ?? 1;
    return hits.length === expected ? null : `${rule.id}: expected ${expected} site(s), found ${hits.length}`;
  }).filter(Boolean);
  assert.deepEqual(wrong, [], 'RUNTIME_RULES has drifted from the runtime — a row matching 0 sites describes a rule that no longer exists');
});

test('no throw site is claimed by two rows', () => {
  // Overlapping excerpts would let one site stand in for another, so a genuinely unclassified rule
  // could ride along on a neighbour's substring and the coverage test above would still pass.
  const doubled = SITES.map((site) => {
    const owners = RUNTIME_RULES.filter((rule) => matchesRule(site, rule)).map((r) => r.id);
    return owners.length > 1 ? `${site.file}:${site.line} claimed by ${owners.join(', ')}` : null;
  }).filter(Boolean);
  assert.deepEqual(doubled, [], 'make these excerpts more specific — an ambiguous excerpt lets one site cover for another');
});

test('every `static` rule is either decided by a checker code or filed as a gap', () => {
  // D138's chaining assertion, and the reason this manifest can ship green today: a rule the checker
  // does not yet decide is not a failure, but an *unanswered* one is. Never neither.
  const assigned = new Set<string>(Object.values(Codes));
  const unanswered = RUNTIME_RULES.filter((r) => r.decidable === 'static' || r.decidable === 'static-if-literal')
    .filter((r) => !r.checkerCode && !r.filedRow)
    .map((r) => r.id);
  assert.deepEqual(
    unanswered,
    [],
    'these rules are statically decidable, so under D137 clause 2 the checker owes them — give each a checkerCode once implemented, or a filedRow tracking the gap',
  );

  const unknownCodes = RUNTIME_RULES.filter((r) => r.checkerCode && !assigned.has(r.checkerCode)).map(
    (r) => `${r.id} -> ${r.checkerCode}`,
  );
  assert.deepEqual(
    unknownCodes,
    [],
    'a checkerCode naming a code `Codes` does not assign. This is the link into diagnosticsCoverage.test.ts: a code implies a DIAGNOSTICS row implies a SPEC §17 row',
  );
});

test('every rule the checker does not owe says why', () => {
  // The note is the whole value of a non-static row. Without it the manifest records a verdict with
  // no reasoning, and the next reader re-derives it — or worse, disagrees silently.
  const silent = RUNTIME_RULES.filter((r) => r.decidable !== 'static' && !r.note).map((r) => r.id);
  assert.deepEqual(silent, [], 'add a `note` saying what this rule needs that the AST does not carry');
});

test('rule ids are unique', () => {
  const ids = RUNTIME_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate rule id: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
});
