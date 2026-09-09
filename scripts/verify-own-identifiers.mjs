#!/usr/bin/env node
// `M186d` (`D959`) — the manifest carries names and nothing lifted from a record.
//
// `refresh-own-identifiers.mjs` states that property in a comment. This asserts it, because the
// failure it guards against is not a bug anyone would write on purpose — it is a **drift with a
// good reason at every step**. Someone adds one line of context per identifier so the file reads
// better; the line after that is a title; the one after that is a first paragraph. At no point does
// anybody decide to publish the records, and at the end the records are published. `D858` would be
// repealed by accretion rather than by decision, which is `self-mutations.mjs`'s
// `the-widening-M164-06-proposed-ships-after-all` arrived at sideways and over months.
//
// So the rule is shape, not judgement: **every entry in `identifiers` must be an identifier and
// nothing else.** There is no field for prose and the gate says so.
//
// `unresolvable` is the one place free text is allowed, and it is allowed on a checkable ground
// rather than an argued one: its values must be **byte-identical** to `DECLARED_UNRESOLVABLE` in
// `gen-decisions.mjs`, which is tracked source in this repository and therefore already public.
// Nothing there came out of a record. A value that differs by one character fails — not because the
// difference is dangerous, but because the moment this file can hold text the other one does not,
// the ground for allowing text here is gone.
//
// Tier 1 runs anywhere. The currency check needs the records and lives in the refresher (`D859`);
// this gate reports that split by name rather than passing silently over it (`D880`, `M131-03`).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DECLARED_UNRESOLVABLE, PREAMBLE } from './gen-decisions.mjs';
import { MANIFEST, readOwnRecords, renderManifest, ownIdentifiers } from './refresh-own-identifiers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The only shape an `identifiers` entry may take. Anchored both ends: a trailing clause is text. */
export const IDENTIFIER = /^(P#\d{1,3}[a-z]?|D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)$/;

export function shapeProblems(manifest) {
  const out = [];
  const ids = manifest.identifiers;
  if (!Array.isArray(ids)) return [`\`identifiers\` is ${typeof ids}, not an array — the manifest has changed shape.`];
  const notIds = ids.filter((x) => typeof x !== 'string' || !IDENTIFIER.test(x));
  if (notIds.length) {
    out.push(
      `${notIds.length} entr(y/ies) in \`identifiers\` are not bare identifiers:\n` +
      notIds.slice(0, 5).map((x) => `    ${JSON.stringify(x).slice(0, 120)}`).join('\n') + '\n' +
      '  This file publishes names, never text (D959). An identifier plus one clause of context is\n' +
      '  a second index growing beside DECISIONS.md, and a second index is D858 repealed by\n' +
      '  accretion instead of by decision. Put the sentence in the record and cite it from prose.');
  }
  // No order assertion here on purpose. The first draft carried one and it was VACUOUS — the
  // expression ended `|| true`, so it could not fail — and a lexicographic version would have been
  // worse than nothing, because the refresher sorts by `byId` (kind, then number, then letter), in
  // which `D10` precedes `D9`. Order is a property of the generator and is held by the refresher's
  // own `--check` comparing rendered bytes; asserting it a second time here, wrongly, is the shape
  // this file exists to refuse.
  const extra = Object.keys(manifest).filter((k) => !['$comment', 'repo', 'identifiers', 'unresolvable'].includes(k));
  if (extra.length) {
    out.push(
      `${extra.length} unexpected key(s): ${extra.join(', ')}.\n` +
      '  Every field here is a place text can arrive. A new one is a decision, not an addition.');
  }
  return out;
}

/** `unresolvable` must be the gate's own constant, verbatim — the ground for allowing text at all. */
export function declarationProblems(manifest, declared = DECLARED_UNRESOLVABLE) {
  const out = [];
  const got = manifest.unresolvable ?? {};
  for (const [id, why] of declared) {
    if (!(id in got)) { out.push(`\`${id}\` is declared unresolvable in gen-decisions.mjs and absent from the manifest.`); continue; }
    if (got[id] !== why) {
      out.push(
        `\`${id}\`'s reason differs from DECLARED_UNRESOLVABLE in gen-decisions.mjs.\n` +
        '  The manifest is allowed free text ONLY because that text is generated from tracked source\n' +
        '  and nothing there was lifted from a record. Text this file holds and that one does not has\n' +
        '  no such provenance, and the exemption stops applying to all of it (D959).');
    }
  }
  for (const id of Object.keys(got)) {
    if (!declared.has(id)) out.push(`\`${id}\` is declared unresolvable in the manifest and not in gen-decisions.mjs.`);
  }
  return out;
}

/** The preamble points readers at this file by path. A link to a file that is not there is worse
 *  than no link, because it reads as a dead pointer inside the answer to dead pointers. */
export function linkProblems(preamble = PREAMBLE, root = ROOT) {
  if (!preamble.includes(MANIFEST)) {
    return [`DECISIONS.md's preamble does not mention \`${MANIFEST}\`, which is the artefact it exists to point at.`];
  }
  return existsSync(join(root, MANIFEST)) ? [] : [`the preamble points at \`${MANIFEST}\` and no such file is tracked here.`];
}

/** `readOwnRecords` duplicates `gen-decisions.mjs`'s record predicate. Two copies of one fact drift
 *  (`D489`), and the drift is silent: a record kind this file stops reading simply defines nothing. */
export function recordSetProblems(root = ROOT) {
  const mine = new Set(readOwnRecords(root).map((r) => r.path));
  const theirs = new Set(readdirSync(root).filter((f) => /^PLAN.*\.md$/.test(f) || f === 'PROGRESS.md' || f === 'REVIEW_FINDINGS.md'));
  const missing = [...theirs].filter((f) => !mine.has(f));
  const extra = [...mine].filter((f) => !theirs.has(f));
  if (!missing.length && !extra.length) return [];
  return [`the manifest's record set disagrees with gen-decisions.mjs's: ${[...missing, ...extra].join(', ')} (D489).`];
}

export function selfTest() {
  const ok = []; const bad = [];
  const t = (what, run) => { try { (run() ? ok : bad).push(what); } catch { bad.push(what); } };
  const base = { $comment: '', repo: 'x', identifiers: ['D1', 'M2a', 'P#3'], unresolvable: {} };

  t('a bare identifier list passes', () => shapeProblems(base).length === 0);
  t('an identifier with one clause of context fails — the whole point of the gate',
    () => shapeProblems({ ...base, identifiers: ['D1 — the retry rule'] }).length === 1);
  t('an object entry fails, which is the same drift wearing a different shape',
    () => shapeProblems({ ...base, identifiers: [{ id: 'D1', title: 'the retry rule' }] }).length === 1);
  t('a new top-level key is reported, because every field is a place text can arrive',
    () => shapeProblems({ ...base, summaries: {} }).length === 1);
  t('NEGATIVE CONTROL — a legitimate identifier with a letter and a digit is not text',
    () => shapeProblems({ ...base, identifiers: ['M154f', 'M9a2'] }).length === 0);

  const decl = new Map([['D9', 'because reasons']]);
  t('a reason that matches the gate\'s constant passes',
    () => declarationProblems({ unresolvable: { D9: 'because reasons' } }, decl).length === 0);
  t('a reason edited by one character fails, which is what makes the text exemption checkable',
    () => declarationProblems({ unresolvable: { D9: 'because reasons.' } }, decl).length === 1);
  t('a declaration in the gate and not the manifest is reported',
    () => declarationProblems({ unresolvable: {} }, decl).length === 1);
  t('a declaration in the manifest and not the gate is reported — the other direction',
    () => declarationProblems({ unresolvable: { D9: 'because reasons', D8: 'invented here' } }, decl).length === 1);

  t('a preamble that does not name the manifest is reported', () => linkProblems('nothing here').length === 1);
  t('NEGATIVE CONTROL — the real preamble names it and the file exists', () => linkProblems().length === 0);

  for (const b of bad) console.error(`  ✗ ${b}`);
  if (bad.length) { console.error(`✗ own-identifiers self-test: ${bad.length} of ${ok.length + bad.length} control(s) did not fire`); return 1; }
  console.log(`✓ own-identifiers self-test: ${ok.length} control(s), each shown to fire on the input it exists for`);
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  const path = join(ROOT, MANIFEST);
  if (!existsSync(path)) {
    console.error(`✗ ${MANIFEST} is not in this tree. It is tracked by decision (D959) — a checkout without it\n` +
      '  cannot answer whether an identifier cited in code is a live decision or a typo.');
    return 1;
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { console.error(`✗ ${MANIFEST} does not parse: ${e.message}`); return 1; }

  const problems = [...shapeProblems(manifest), ...declarationProblems(manifest), ...linkProblems()];
  const haveRecords = existsSync(join(ROOT, 'PLAN.md'));
  if (haveRecords) problems.push(...recordSetProblems());

  if (problems.length) {
    console.error(`✗ own-identifiers: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ${p}\n`);
    return 1;
  }
  const n = manifest.identifiers.length;
  const u = Object.keys(manifest.unresolvable ?? {}).length;
  console.log(
    `✓ own-identifiers: ${n} identifier(s), names only — no field carries record text; ` +
    `${u} declared unresolvable, each byte-identical to gen-decisions.mjs.`);
  console.log(haveRecords
    ? '  record set agrees with gen-decisions.mjs; currency is `refresh-own-identifiers.mjs --check`.'
    : '  currency NOT checked here: it needs the gitignored records (D859). Shape and provenance are.');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
