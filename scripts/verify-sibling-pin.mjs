#!/usr/bin/env node
/**
 * The pin's readback (`M175a`, `D899`). Closes `M172-01`.
 *
 * `scripts/sibling-citations.json` records a `ref`, a `sha` and a `source` URL naming the sibling
 * commit whose prose this index publishes (`D709`/`D710`). Nothing checked that any of the three
 * still resolved. `M172-01`: from `1bf108f` until 2026-09-05 the pin named a branch squash-merged as
 * tflw-tests `#79`, whose sha is not an ancestor of that repository's `main` and survived only
 * because the branch had not been deleted.
 *
 * WHY READ TIME AND NOT ONLY WRITE TIME (`D899`). A write-time check — refuse to write a pin that
 * does not resolve — is nearly free and is also built, in `refresh-sibling-citations.mjs`. It is
 * structurally incapable of catching this row's failure: the pin was **valid when written** and was
 * invalidated later, by a merge in the *other* repository. Only a check that runs again afterwards
 * sees it. Demonstrated rather than argued: this gate was written on 2026-09-06 against a pin that
 * had gone dead twenty minutes earlier, when merging tflw-tests `#82` deleted the branch its `ref`
 * names and orphaned the commit its `sha` records.
 *
 * WHY IT IS A TIER AND SAYS SO (`D683`). Resolving a sibling commit needs the network and a
 * credential. CI holds a depth-1 clone and `verify-provenance.mjs` declines the same check for that
 * reason, correctly. A gate that silently passed where it could not look would be worse than none —
 * so where `gh` cannot answer, this prints what it *would* have checked and exits 0 saying it did
 * not run. Where `gh` can answer, every clause is enforced.
 *
 * WHAT IT DOES NOT DO. It does not fetch `source`. That URL points at github.com and this repository
 * does not make gates that reach arbitrary external targets; the `source` clause is a *consistency*
 * check — the URL must name the sha the pin records — which is the failure that can actually happen
 * when a pin is hand-edited, and needs no network at all.
 *
 * @file
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSiblingPin } from './gen-decisions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** @returns {string|null} stdout, or null when `gh` cannot answer at all. */
function gh(args) {
  try {
    return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

const problems = [];
const notes = [];
const fail = (what, detail) => problems.push({ what, detail });

const pin = readSiblingPin(ROOT);
const repo = pin.repo;

// `D865`: a pin built from a local checkout names a commit no reader can fetch. `readSiblingPin`
// already refuses to publish against one; here it is a failure rather than a skip (`D880`), because
// "the readback could not run" and "the pin is unfetchable by construction" are opposite states and
// only one of them is acceptable.
if (pin.local === true || pin.fromCheckout) {
  fail('the pin was built from a local checkout',
    'D710 refuses a pin naming a commit no reader can fetch. Re-pin from a pushed ref before this can be checked.');
}

for (const field of ['ref', 'sha', 'source']) {
  if (!pin[field]) fail(`the pin has no \`${field}\``, 'All three are recorded together and are checked together.');
}

// The `source` clause needs no network: it is a consistency check between two fields of one file.
if (pin.sha && pin.source && !pin.source.includes(pin.sha)) {
  fail('`source` does not name the sha the pin records',
    `source: ${pin.source}\n  sha:    ${pin.sha}\n  These are written by the same script in the same pass, so a disagreement means the file was hand-edited.`);
}

const reachable = gh(['api', 'user', '--jq', '.login']) !== null;
if (!reachable) {
  // `D683`. Name the clauses that did not run, so a green here cannot be read as a green there.
  console.log('✓ sibling pin: the offline clauses hold');
  console.log(`  ref=${pin.ref}  sha=${String(pin.sha).slice(0, 7)}`);
  console.log('  NOT RUN — `gh` could not answer, so these three clauses were not checked:');
  console.log('    · the sha still resolves in the sibling repository');
  console.log('    · the ref still exists there');
  console.log('    · the sha is an ancestor of the ref, i.e. it was not orphaned by a squash-merge');
  console.log('  This is the tier that needs a credential (D683). CI holds a depth-1 clone and cannot');
  console.log('  run it either; it is enforced on a machine that can pin.');
  if (problems.length === 0) process.exit(0);
} else {
  if (pin.sha) {
    const got = gh(['api', `repos/${repo}/commits/${encodeURIComponent(pin.sha)}`, '--jq', '.sha']);
    if (got === null) fail('the pinned sha no longer resolves', `${repo}@${pin.sha} — the commit is gone, so nothing can read what this index publishes from.`);
    else notes.push(`sha ${pin.sha.slice(0, 7)} resolves`);
  }
  if (pin.ref) {
    const head = gh(['api', `repos/${repo}/commits/${encodeURIComponent(pin.ref)}`, '--jq', '.sha']);
    if (head === null) {
      fail('the pinned ref no longer exists',
        `${repo}@${pin.ref} — a branch deleted on merge is the commonest way this happens, and it is exactly how M172-01 was re-created on 2026-09-06.`);
    } else {
      notes.push(`ref ${pin.ref} exists`);
      // The ancestry clause is the one that matters, and the one no other check covers. A
      // squash-merge orphans the branch commit: the object survives, the ref may survive, and the
      // tree the pin names is on no line of history anybody reads. `M170-02` is the same mechanism
      // one layer down, at a vendored build's recorded commit.
      if (pin.sha && head !== pin.sha) {
        const status = gh(['api', `repos/${repo}/compare/${encodeURIComponent(pin.ref)}...${pin.sha}`, '--jq', '.status']);
        if (status === null) fail('the sha and the ref could not be compared', `${repo}: ${pin.ref}...${pin.sha}`);
        else if (status !== 'behind' && status !== 'identical') {
          fail('the pinned sha is not an ancestor of the ref it names',
            `${repo}: compare ${pin.ref}...${pin.sha} reports \`${status}\`.\n` +
            '  This is what a squash-merge does to the branch commit a pin was taken from: the object\n' +
            '  survives and the history does not contain it. Re-pin against the merged ref.');
        } else notes.push(`sha is ${status} the ref`);
      } else if (pin.sha) notes.push('sha is the ref head');
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`\n✗ ${p.what}\n  ${p.detail.split('\n').join('\n  ')}`);
  console.error(`\n${problems.length} problem(s) with ${repo}'s pin.`);
  console.error('  Re-pin with `node scripts/refresh-sibling-citations.mjs --ref main`, then regenerate');
  console.error('  DECISIONS.md in the same pass — the pin carries which sibling file cites each');
  console.error("  identifier, and that is printed as each entry's `cited from` line (M162-04).");
  process.exit(1);
}

console.log(`✓ sibling pin: ${repo}@${pin.ref} — ${notes.join(', ')}, and \`source\` names the same sha`);
