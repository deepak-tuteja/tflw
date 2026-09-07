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
 * WHY IT IS A TIER AND SAYS SO (`D683`). Resolving a sibling commit needs the network. A gate that
 * silently passed where it could not look would be worse than none — so where `gh` cannot answer,
 * this prints what it *would* have checked and exits 0 saying it did not run. Where `gh` can answer,
 * every clause is enforced.
 *
 * THAT TIER USED TO CARRY A WRONG REASON, AND THE CORRECTION IS WHY THIS RUNS IN CI (`M179b`,
 * `D920`). It said the check *"needs the network and a credential. CI holds a depth-1 clone and
 * `verify-provenance.mjs` declines the same check for that reason, correctly."* That conflated two
 * unrelated blockers. `verify-provenance.mjs` declines because a **depth-1 clone** does not hold the
 * objects it would have to walk — a git problem, and its reason is still correct for it. This gate
 * does not use git at all; it uses `gh api`, and **both repositories are public**, so the reads need
 * nothing Actions does not already provide. The sentence had been true of neither half since it was
 * written, and it is the reason the only instrument that can see a dead pin spent its whole life
 * unreachable from CI while the pin died five times in two days (`M176-06`).
 *
 * AND A TIER THAT CAN DEGRADE SILENTLY IS A VACUOUS GATE IN CI (`D921`). The `D683` skip is right on
 * a developer machine, where `gh` may genuinely be absent. In CI it would be a trap of exactly the
 * shape this repository keeps filing: if the token were ever wrong, every clause would stop running,
 * the gate would print its skip, exit 0, and go on being green forever — `M141`, an instrument never
 * pointed at its corpus. So CI passes `--require-network`, which turns the skip into a failure.
 * The flag exists to make the tier's own reachability observable, and nothing else.
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
import { readSiblingPin, PULL_REF } from './gen-decisions.mjs';

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

// `D914`, the shape clause. Offline, and it is the one clause that would have prevented `M176-06`
// rather than reported it: a branch-name pin is not wrong when written, it is wrong later, and by
// then the branch is gone and the message can only say so after the fact. Refusing the shape refuses
// the whole class up front. A local pin is failed above and its ref is not a published ref at all,
// so it is not also shape-checked — one cause, one message.
if (pin.ref && !pin.local && !pin.fromCheckout && !PULL_REF.test(pin.ref)) {
  fail('the pin names a ref that cannot outlive the merge that uses it',
    `ref: ${pin.ref}\n`
    + '  A published pin names `refs/pull/<N>/head` — the one ref GitHub never deletes. Measured\n'
    + '  2026-09-07 on the already-merged #83: its branch ref is a 422 and its pull ref still\n'
    + '  resolves, `identical` to the sha. A branch name dies on the squash-merge that deletes it,\n'
    + '  and `main` cannot be pinned at all under `D511` — tflw merges first, so at pin time the\n'
    + '  sibling commit is not on the sibling\'s main yet. Re-pin with `--pr <N>`.');
}

// The `source` clause needs no network: it is a consistency check between two fields of one file.
if (pin.sha && pin.source && !pin.source.includes(pin.sha)) {
  fail('`source` does not name the sha the pin records',
    `source: ${pin.source}\n  sha:    ${pin.sha}\n  These are written by the same script in the same pass, so a disagreement means the file was hand-edited.`);
}

/**
 * `D921`. Where this runs decides whether the `D683` skip is honest or is a vacuous gate.
 *
 * On a developer machine `gh` may genuinely be absent, and printing the three unrun clauses is the
 * right answer. In CI it is the wrong one: a token that stopped working would make every clause stop
 * running, and the job would stay green about it indefinitely — `M141`, an instrument never pointed
 * at its corpus, planted in the gate that closes `M176-06`. So CI passes `--require-network` and the
 * skip becomes a failure. Nothing else changes: the flag cannot make a passing clause fail or a
 * failing one pass, it only refuses to accept "did not run" as an answer.
 */
const requireNetwork = process.argv.includes('--require-network');

const reachable = gh(['api', 'user', '--jq', '.login']) !== null;
if (!reachable && requireNetwork) {
  console.error('\n✗ the network tier could not run, and this caller requires it');
  console.error('  `gh api user` did not answer, so none of the three clauses below were checked:');
  console.error('    · the sha still resolves in the sibling repository');
  console.error('    · the ref still exists there');
  console.error('    · the sha is an ancestor of the ref, i.e. it was not orphaned by a squash-merge');
  console.error('  --require-network was given, so this is a failure rather than the D683 skip.');
  console.error('  In CI that means `gh` is missing or GH_TOKEN is unset/expired. Both repositories');
  console.error('  are public, so the reads need nothing beyond a working `gh` — see D920.');
  process.exit(1);
}
if (!reachable) {
  // `D683`. Name the clauses that did not run, so a green here cannot be read as a green there.
  console.log('✓ sibling pin: the offline clauses hold');
  console.log(`  ref=${pin.ref}  sha=${String(pin.sha).slice(0, 7)}`);
  console.log('  NOT RUN — `gh` could not answer, so these three clauses were not checked:');
  console.log('    · the sha still resolves in the sibling repository');
  console.log('    · the ref still exists there');
  console.log('    · the sha is an ancestor of the ref, i.e. it was not orphaned by a squash-merge');
  console.log('  This is the tier that needs the network (D683). Where it must not be skipped, the');
  console.log('  caller passes --require-network and this becomes a failure (D921).');
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
  console.error('  Re-pin with `node scripts/refresh-sibling-citations.mjs --pr <N>`, then regenerate');
  console.error('  DECISIONS.md in the same pass — the pin carries which sibling file cites each');
  console.error("  identifier, and that is printed as each entry's `cited from` line (M162-04).");
  process.exit(1);
}

console.log(`✓ sibling pin: ${repo}@${pin.ref} — ${notes.join(', ')}, and \`source\` names the same sha`);
