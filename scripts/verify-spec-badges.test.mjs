// `M253` `D` (X7) — SPEC.md's status badges tell the truth, and a promise has an owner.
//
// Every section heading carries a badge: ✅ shipped, 🔮 planned, 🔧 mixed. Measured at the start of
// `M253`, seven of the eight open heading badges no longer described their section — sections
// marked mixed because of a feature that had since shipped, a parking lot listing the recorder, the
// docs site and `tflw fmt` as out of v1 while all three were in it. A badge nobody owns is how that happens: *planned* by no milestone is a
// sentence nothing will ever make true or false. So a 🔮 or 🔧 on a heading must name the
// milestone, decision or principle that owns it, on the same line, and that id must resolve in
// `DECISIONS.md` — the resolver `verify:decisions` already holds every other citation to.
//
// Headings only. A badge in running prose — the legend, a sentence that explains what *planned*
// means — is a use of the word, not a claim about a section.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OWNER = /`?(P#\d+|D\d+[a-z]?|M\d+[a-z]?\d*)`?/g;

/** Every open badge on a heading in `spec`, with the ids its line names and whether each resolves. */
export function badgeProblems(spec, decisions) {
  const anchors = new Set([...decisions.matchAll(/^### (P#\d+|D\d+[a-z]?|M\d+[a-z]?\d*)\s*$/gm)].map((m) => m[1]));
  const problems = [];
  spec.split('\n').forEach((line, i) => {
    if (!/^#{2,4} /.test(line)) return;
    const at = Math.max(line.indexOf('🔮'), line.indexOf('🔧'));
    if (at === -1) return;
    const owners = [...line.slice(at).matchAll(OWNER)].map((m) => m[1]);
    if (owners.length === 0) problems.push({ line: i + 1, heading: line, why: 'names no owner after its badge' });
    for (const id of owners) if (!anchors.has(id)) problems.push({ line: i + 1, heading: line, why: `names ${id}, which DECISIONS.md does not define` });
  });
  return problems;
}

const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
const decisions = readFileSync(join(ROOT, 'DECISIONS.md'), 'utf8');

test('every 🔮/🔧 heading in SPEC.md names its owner, and the owner resolves in DECISIONS.md (M253 D)', () => {
  const problems = badgeProblems(spec, decisions);
  assert.deepEqual(problems, [], problems.map((p) => `SPEC.md:${p.line} ${p.why}\n  ${p.heading}`).join('\n'));
});

test('the gate reads something: SPEC.md has headings with badges, and at least one is open (M253 D)', () => {
  const headings = spec.split('\n').filter((l) => /^#{2,4} /.test(l));
  assert.ok(headings.filter((l) => l.includes('✅')).length > 10, 'SPEC.md headings carry ✅ badges');
  assert.ok(headings.some((l) => l.includes('🔧') || l.includes('🔮')), 'an open badge exists for the rule to judge — if none is left, this control goes');
});

test('a badge with no owner, and one whose owner is not a decision, are both refused (M253 D)', () => {
  const planted = ['## 3. Something 🔮', '## 4. Another 🔧 (waits for `D999999`)', '## 5. Fine 🔧 (`D1379`)', 'Prose that says 🔮 planned is fine.'].join('\n');
  const found = badgeProblems(planted, '### D1379\n');
  assert.deepEqual(found.map((p) => [p.line, p.why]), [
    [1, 'names no owner after its badge'],
    [2, 'names D999999, which DECISIONS.md does not define'],
  ]);
});
