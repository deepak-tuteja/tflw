#!/usr/bin/env node
// `M186c` (`D959`) — the manifest of identifiers this repository's records define.
//
// ## The question it answers
//
// `D858` splits `D675`: an identifier cited in tracked prose must resolve **and** publish; one
// cited in tracked code must only resolve. The split is deliberate and it is not going to change —
// publication is irreversible, and a prose citation is the act of nominating a record block as fit
// to publish, which a code comment is not. But it leaves a reader of a **public** repository with
// no way to tell a live decision from a dead pointer: `D911` is named in the docblock of the
// function that decides anchor precedence, and `DECISIONS.md` says nothing about it.
//
// `--demand` already guarantees there is no dead pointer — it reads every tracked non-prose file
// and fails on any identifier that resolves to nothing. What it cannot do is tell a reader that,
// because it needs the records and the records are gitignored (`D668`, `D859`). **A guarantee that
// can only be checked where the records are is a sentence a reader has to trust.** This is the
// tracked artefact that carries it across that boundary — `M169d4`'s precedent, applied to the
// repository that owns the notation.
//
// ## Names, never text — and that is the load-bearing part
//
// It carries **identifiers, and nothing lifted from a record**. Not a title, not a first line, not
// a one-line summary. An identifier alone leaks nothing: every name in here is already printed in
// this repository's own tracked source, which is how a reader arrived with the question.
//
// The temptation is a single line of justification per entry, and that is exactly the direction
// this file must not drift. An artefact that carries one sentence per identifier is a second index,
// and a second index is `D858` repealed by accretion rather than by decision — the mutation
// `self-mutations.mjs` names `the-widening-M164-06-proposed-ships-after-all`, arrived at sideways.
// `verify-own-identifiers.mjs` asserts the property rather than this comment promising it.
//
// `unresolvable` is the other half of the same answer and is exempt from that rule for a reason
// that is checkable rather than argued: its reasons are generated from `DECLARED_UNRESOLVABLE` in
// `gen-decisions.mjs`, which is **tracked source in this repository** and already public. Nothing
// there was lifted from a record. Generated rather than restated so a declaration cannot be added
// to the gate and forgotten here.
//
// ## Usage
//
//   node scripts/refresh-own-identifiers.mjs            # rewrite the manifest
//   node scripts/refresh-own-identifiers.mjs --check    # fail if it is out of date
//
// `--check` needs the records, so it is a developer discipline and not a CI gate (`D859`). CI checks
// the manifest is present, well-formed and free of record prose; only a machine with the records can
// check that it is *current*.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectAnchors, collectLegacy, DECLARED_UNRESOLVABLE } from './gen-decisions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const MANIFEST = 'scripts/own-identifiers.json';

/**
 * The records. Same set `gen-decisions.mjs`'s own `readRecords` reads — imported would be better
 * still, but it is not exported, and duplicating the four-name predicate is a smaller wrong than
 * widening that module's surface for one caller. `verify-own-identifiers.mjs` asserts the two agree.
 */
export function readOwnRecords(root) {
  const names = readdirSync(root)
    .filter((f) => /^PLAN.*\.md$/.test(f) || f === 'PROGRESS.md' || f === 'REVIEW_FINDINGS.md');
  return names.sort().map((f) => ({ path: f, text: readFileSync(join(root, f), 'utf8') }));
}

/**
 * Every identifier the records ANCHOR — the widest defensible rule, and the same one the sibling's
 * manifest takes. Not "the ones `DECISIONS.md` omits": that would be a derived difference of two
 * sets, so the file would churn whenever either side moved, and a reader would have to understand
 * the publish/no-publish split before knowing which file to open. The subject here is *what the
 * records define*, which moves only when the records do.
 */
export function ownIdentifiers(records) {
  const ids = new Set(collectAnchors(records).keys());
  // `P#n` is anchored by a different mechanism — a numbered list in `PLAN.md`, read by
  // `collectLegacy` — and omitting it left exactly three of the 324 unanswered on the first run
  // (`P#9`, `P#47`, `P#109`, all cited in tracked code). The subject of this file is what the
  // records define, and the founding list defines a third of the notation; a manifest silent about
  // it would be silent in precisely the range where the two sequences collide on the number.
  for (const n of collectLegacy(records.find((r) => r.path === 'PLAN.md')?.text ?? '').keys()) ids.add(`P#${n}`);
  return ids;
}

const byId = (a, b) => {
  const p = (s) => { const m = /^(P#|[DM])(\d+)([a-z]?)(\d?)$/.exec(s); return m ? [m[1], +m[2], m[3], m[4]] : [s, 0, '', '']; };
  const [ak, an, al, ax] = p(a); const [bk, bn, bl, bx] = p(b);
  return ak.localeCompare(bk) || an - bn || al.localeCompare(bl) || ax.localeCompare(bx);
};

/**
 * No record count and no generation date, for the sibling manifest's reason: both would be true and
 * both would churn, so `--check` would fail for something that is not about identifiers and the next
 * person would learn to re-run the refresher without reading the diff. The manifest moves when its
 * subject moves.
 */
export function renderManifest(ids, unresolvable) {
  return JSON.stringify({
    $comment: 'Generated by scripts/refresh-own-identifiers.mjs (M186c, D959). Do not edit by hand. '
      + 'Identifiers only: an identifier cited in tracked code must resolve in the design records but is '
      + 'deliberately not published in DECISIONS.md (D858), and this is how a checkout can tell a live '
      + 'decision from a dead pointer without any record text being published. The unresolvable reasons '
      + 'are generated from DECLARED_UNRESOLVABLE in scripts/gen-decisions.mjs, which is tracked source.',
    repo: 'deepak-tuteja/tflw',
    identifiers: [...ids].sort(byId),
    unresolvable: Object.fromEntries([...unresolvable].sort((a, b) => byId(a[0], b[0]))),
  }, null, 2) + '\n';
}

function main(argv) {
  const records = readOwnRecords(ROOT);
  if (records.length === 0) {
    console.error(
      "✗ the design records are not in this tree, so the manifest cannot be refreshed.\n" +
      "  PLAN_*.md, PROGRESS.md and REVIEW_FINDINGS.md are .gitignore'd by decision (D668) — run this\n" +
      "  on a machine that has them. A CI checkout never can, which is why --check is a developer\n" +
      "  discipline and CI checks shape rather than currency (D859).",
    );
    return 1;
  }
  const ids = ownIdentifiers(records);
  const next = renderManifest(ids, DECLARED_UNRESOLVABLE);
  const path = join(ROOT, MANIFEST);
  let current = null;
  try { current = readFileSync(path, 'utf8'); } catch { /* first run */ }

  if (argv.includes('--check')) {
    if (current === next) {
      console.log(`✓ own-identifiers.json is current: ${ids.size} identifier(s) from ${records.length} record(s).`);
      return 0;
    }
    const had = current ? new Set(JSON.parse(current).identifiers) : new Set();
    const added = [...ids].filter((i) => !had.has(i)).sort(byId);
    const gone = [...had].filter((i) => !ids.has(i)).sort(byId);
    console.error(
      `✗ own-identifiers.json is out of date against the ${records.length} record(s) in this tree.\n` +
      (added.length ? `  now anchored and not in the manifest: ${added.join(' ')}\n` : '') +
      (gone.length ? `  in the manifest and no longer anchored: ${gone.join(' ')}\n` : '') +
      '  Run `npm run refresh:own-identifiers` and commit the result. An identifier this repository\n' +
      "  defines and the manifest omits is one a reader of a public file cannot distinguish from a\n" +
      '  typo — which is the whole of what this artefact is for (D959).',
    );
    return 1;
  }

  writeFileSync(path, next);
  console.log(`✓ own-identifiers.json: ${ids.size} identifier(s) from ${records.length} record(s)${current === next ? ' (unchanged)' : ''}.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
