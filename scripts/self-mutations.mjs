// M123 — the mutations this tool aims at its own instrumentation.
//
// WHY THESE LIVE IN A FILE OF THEIR OWN, and it is not tidiness. A mutation is applied by exact
// string match, and the runner refuses to proceed unless the target occurs **exactly once** in the
// file it names — a deliberate guard, from `M97e`'s rule that a probe which cannot run is not a
// probe that found nothing. A self-targeting mutation defeats that guard by construction: the
// string appears once in the code being mutated, and a second time in the `find:` literal that
// describes it. Measured, the first time these were written inline in `mutate.mjs`:
//
//     baseline root:test:scripts … green, 49 passing
//     ⚠ signal-handlers-removed (m123) — target matched 2 times, not 1; source has drifted. NOT RUN.
//     ⚠ journal-opened-after-the-write (m123) — target matched 2 times, not 1 …
//     … 7 of 9 stale
//     9 mutation(s) run; 0 survived, 7 stale.        ← and the process exited 0
//
// Seven controls that never ran, in a report whose headline number was zero survivors — the
// vacuous-control shape this file's own header keeps returning to, produced here by the very guard
// that exists to prevent it. (The `stale` count is printed and *is* the tell; it is not fatal
// because a drifted target is a normal thing to discover mid-refactor. The lesson is the older one:
// read the line under the headline.)
//
// The two entries that did run first time are the two whose targets live in other modules — the
// same rule seen from the other side. So the fix is structural and needs no change to the runner:
// a mutation's text must never live in the file it targets.
//
// WHY SELF-MUTATE AT ALL. `scripts/mutate.mjs` is 1100 lines, it rewrites tracked sources in place,
// every "0 survived" verdict in this repo rests on it, and until `M123` it had no tests. Each guard
// added there would otherwise be a claim rather than a control — the shape `M122-01` cost a
// silently-deleted mutation to learn. Self-mutation is only safe because of the `main` guard
// (D224): the suite here is `npm run test:scripts`, whose child imports `mutate.mjs` and runs
// nothing.

/** The root `test:scripts` suite, for a mutation that names no workspace. Declared here rather than
 *  in `mutate.mjs` only to keep the import acyclic — `mutate.mjs` re-exports it. */
export const ROOT_SUITE = 'root:test:scripts';

/** The runner itself, as a mutation target. */
export const SELF = 'scripts/mutate.mjs';

export const SELF_MUTATIONS = [
  {
    id: 'signal-handlers-removed',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: '`M118-03` restored: no SIGINT/SIGTERM handler, so Ctrl-C takes the default action and the process dies where it stands — the `finally` never runs and the mutation is left on disk',
    find: "  for (const sig of ['SIGINT', 'SIGTERM']) {",
    replace: '  for (const sig of []) {',
  },
  {
    id: 'journal-opened-after-the-write',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: 'the journal is written *after* the source is mutated rather than before. The window between the two writes is far too small to observe from another process — so the control is the failure path instead: point the journal at a location that cannot be written, and the correct order stops with the source untouched while this one leaves it mutated with no record of what it was',
    find: `    if (!openJournal({ id: m.id, milestone: m.milestone, pid: process.pid, startedAt: new Date().toISOString(), files })) return 2;
    writeFileSync(full, mutated);`,
    replace: `    writeFileSync(full, mutated);
    if (!openJournal({ id: m.id, milestone: m.milestone, pid: process.pid, startedAt: new Date().toISOString(), files })) return 2;`,
  },
  {
    id: 'stale-journal-left-alone',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: 'a journal left by a dead run is ignored instead of repaired, so the next sweep baselines against a tree that still holds the previous run\'s mutation — the `kill -9` case, which no signal handler reaches',
    find: '  if (!journal) return 0;',
    replace: '  if (journal) return 0;',
  },
  {
    id: 'unknown-option-ignored',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: 'unrecognised flags are silently dropped again — `mutate.mjs m118 --list` starts a sweep instead of listing, which is the keystroke that opened `M118-03`',
    // M127 widened this line to admit `--shard=` and `--manifest=`, and the `find:` was not updated
    // with it — so this control reported `target matched 0 times … NOT RUN` on the first real sweep
    // after the change. Caught, which is the whole point: a mutation whose target has drifted is
    // counted as a survivor and turns the run red, exactly so that it cannot be a quiet zero. It is
    // also the second time this milestone's own edits have gone stale against this file, the first
    // being the tally line below — the standing cost of a control that quotes the code verbatim, and
    // cheaper than the alternative of not quoting it.
    find: "  const unknown = flags.filter((f) => f !== '--list' && !f.startsWith('--shard=') && !f.startsWith('--manifest='));",
    replace: '  const unknown = [];',
  },
  {
    id: 'node-test-context-inherited',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: '`M123-02` restored: `NODE_TEST_CONTEXT` is passed to the suite, which then speaks node:test\'s internal serializer instead of reporting — 472 bytes, no summary, exit 0, so every mutation reads as SURVIVED and every baseline as `? passing`',
    find: '  delete env.NODE_TEST_CONTEXT;',
    replace: '  void env;',
  },
  {
    id: 'root-suite-collapsed',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: 'a `root:test:scripts` mutation is run as `npm test -w root:test:scripts`, which is not a workspace — the self-targeting mutations below would all fail to run rather than fail to kill',
    find: "  return pkg === ROOT_SUITE ? 'npm run test:scripts 2>&1' : `npm test -w ${pkg} 2>&1`;",
    replace: '  return `npm test -w ${pkg} 2>&1`;',
  },
  {
    id: 'registry-count-guard-off',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: '`M122-01`\'s guard neutered: the written-vs-built count is computed and thrown away, so a missing `},` between two entries deletes a mutation in silence again',
    find: '  if (idKeysWritten === built) return undefined;',
    replace: '  if (idKeysWritten !== built) return undefined;',
  },
  {
    id: 'live-sweep-treated-as-stale',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: SELF,
    what: '`M123-03` restored: a journal whose owner is still running is repaired instead of respected, so a second process un-mutates a live sweep\'s source mid-suite and reports that "a previous run died" about a run that is not dead. The first sweep then measures unmutated code and calls it SURVIVED',
    find: '  if (isProcessAlive(journal.pid) && journal.pid !== process.pid) {',
    replace: '  if (false) {',
  },
  {
    id: 'ansi-not-stripped',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: 'scripts/reporter-summary.mjs',
    what: '`M115-01`/`M123-01` restored: the summary parse is `^`-anchored against raw output, so any environment exporting `FORCE_COLOR` defeats it — on any Node, in both consumers',
    find: "  return text.replace(SGR, '');",
    replace: '  return text;',
  },
  {
    id: 'journal-restore-errors-escape',
    milestone: 'm123',
    pkg: ROOT_SUITE,
    file: 'scripts/mutation-journal.mjs',
    what: 'a file the journal cannot put back throws out of `applyJournal` instead of being reported, abandoning every remaining file in the same entry — including the side-effect snapshots',
    find: '      problems.push(`${rel}: ${err.message}`);',
    replace: '      throw err;',
  },
  {
    id: 'coverage-guard-off',
    milestone: 'm126',
    pkg: ROOT_SUITE,
    file: SELF,
    what: '`M125e-02`\'s guard neutered: the M98 accounting is computed and thrown away, so the two sides can drift apart again — a group reconstructed without dropping its `UNRECONSTRUCTED` entry, or the reverse, and the summary line goes on quoting a number nothing checks',
    find: '  if (problems.length === 0) return undefined;',
    replace: '  return undefined;',
  },
  {
    id: 'coverage-clause-dropped-from-the-tally',
    milestone: 'm126',
    pkg: ROOT_SUITE,
    file: SELF,
    what: '`M125e-02` itself: the denominator leaves the summary line, so the sweep ends on a complete-sounding `N mutation(s) run; 0 survived` over a registry that covers part of the plan — the shape three findings on this board now share',
    find: '    `— over a registry that reconstructs ${cov.reconstructed} of the M98 plan\'s ${cov.planned} mutations, ${cov.missing} not.`',
    replace: "    ''",
  },
  {
    id: 'shard-partition-drops-a-chunk',
    milestone: 'm127',
    pkg: ROOT_SUITE,
    file: SELF,
    what: "M127's partition stops being a partition: the last chunk is never packed, so one shard's worth of mutations is run by nobody and every shard is green about the rest. The totality guard inside `partition()` is what has to notice, because CI cannot — five green shards look exactly like six",
    find: '  chunks.forEach((c, nth) => {',
    replace: '  chunks.slice(0, -1).forEach((c, nth) => {',
  },
  {
    id: 'empty-shard-runs-clean',
    milestone: 'm127',
    pkg: ROOT_SUITE,
    file: SELF,
    what: 'the guard against splitting a registry into more shards than it has mutations is removed, so `--shard=200/200` sweeps nothing, prints a tally, and exits 0 — the vacuous-green shape this file keeps returning to, reached this time through the flag added to prevent it',
    find: '    if (shard.of > selected.length) {',
    replace: '    if (false) {',
  },
  {
    id: 'overflow-reported-as-a-hang',
    milestone: 'm147e',
    pkg: ROOT_SUITE,
    file: SELF,
    what: "`M147e-01` restored: an output overflow is read off the signal alone and reported as `the suite hung`. The verdict is right by accident — no verdict either way — and the sentence is wrong in the one word that tells the reader where to look, so they go hunting an infinite loop in a suite that ran to completion. The instrument's own failure mode, which is why it is registered here rather than beside the product row that found it",
    find: "  const overflowed = err.code === 'ENOBUFS';",
    replace: '  const overflowed = false;',
  },
  {
    id: 'cross-workspace-mutation-scored-stale',
    milestone: 'm147e',
    pkg: ROOT_SUITE,
    file: SELF,
    what: "`M147-09` restored: a mutation whose file is in one workspace and whose suite is in another is scored against the previous build, so it can only ever come back `SURVIVED`. A false survival, not a no-verdict — it reads as a measurement that the assertion is weak, and the response it invites is deleting the test that was right",
    find: '  const rebuild = mutatedFile ? rebuildTargetFor(mutatedFile, pkg, workspaceName) : null;',
    replace: '  const rebuild = null;',
  },

  // --- M148 (`M147-11`) ---------------------------------------------------------------------
  //
  // Both of these are the same shape as the row that produced them: a number the packer trusts,
  // with nothing downstream re-measuring it. The first kills the measurement at the source; the
  // second kills the check that reads it back. Neither can be caught by any mutation already here,
  // because before M148 there was nothing in this file that knew what a shard cost.
  {
    id: 'baseline-cost-never-measured',
    milestone: 'm148',
    pkg: ROOT_SUITE,
    file: SELF,
    what: 'the measured baseline seconds are dropped on the floor, so every manifest reports `costs: {}` and `verify-shards.mjs` has nothing to compare `SUITE_SECONDS` against. The sweep still runs, every shard still passes, and the constants go back to being unfalsifiable — which is exactly the state that let the root suite drift 3.5× and cost a shard',
    find: '  measuredSeconds.set(pkg, Math.round((Date.now() - startedAt) / 1000));',
    replace: '  void startedAt;',
  },
  {
    id: 'shard-budget-is-the-limit-itself',
    milestone: 'm148',
    pkg: ROOT_SUITE,
    file: SELF,
    what: "the re-shard trigger is moved from two-thirds of the limit to the limit, which is `M131-06`'s error made executable: a shard that reaches 30m has already been cancelled by `timeout-minutes` and uploaded no manifest, so the check can only ever fire on a run where it had nothing to read. A trigger at the limit is a trigger that never fires",
    find: 'export const RESHARD_AT = 2 / 3;',
    replace: 'export const RESHARD_AT = 1;',
  },
  // --- M147f (`M131-03`) ------------------------------------------------------------------------
  //
  // The first mutation in this repo aimed at `verify-ledger.mjs`, which is worth stating plainly:
  // `M140` built the stamp guard there, `M145` rewrote two of its checks and `M147a` added a third,
  // and until now nothing had ever demonstrated that its tests can fail. That is `M147-05` with a
  // name — the registry's newest entries are the ones somebody happened to write, not the ones the
  // most-relied-on instrument owed.
  //
  // This restores the pre-fix code exactly, rather than breaking it in some new way, so what it
  // proves is the reported defect and not a neighbour of it: with `shipped === null` the loop used
  // to run over **every** plan, and a plan that had merely been written was read as merged.
  {
    id: 'plan-claims-guessed-when-git-is-absent',
    milestone: 'm147f',
    pkg: ROOT_SUITE,
    file: 'scripts/verify-ledger.mjs',
    what: "off a git checkout the plan↔ledger check goes back to treating every plan as shipped. It does not fail quietly: it names a row and a line and asserts the milestone is on `main`, and the cheapest way to make it green is to close a row that is still open — the guard talking a reader into the corruption it exists to catch",
    edits: [
      ['    if (!planClaimsChecked) break\n', ''],
      ['    if (!shipped.has(gate)) continue', '    if (shipped && !shipped.has(gate)) continue'],
    ],
  },
  // --- M147f (`M147-06`) --------------------------------------------------------------------
  {
    id: 'helper-resolution-back-to-a-character-window',
    milestone: 'm147f',
    pkg: ROOT_SUITE,
    file: 'scripts/verify-test-observability.mjs',
    what: "the resolver goes back to giving up on any arrow helper whose return-type annotation puts the `=>` more than twenty characters past the parameter list. The loud direction reports nine true assertions as vacuous, and the obvious way to silence a false `✗` is to delete the code name from the test — the tool degrading what it exists to protect. The quiet direction is worse: a test whose only harness is such a helper resolves to no stage at all and joins the `not analysed` list, which is printed and does not fail",
    find: '    if (arrow === -1 || !isReturnAnnotation(code.slice(closeParen + 1, arrow))) continue;',
    replace: '    if (arrow === -1 || arrow > closeParen + 20) continue;',
  },
  // --- M152a (`D675`, `D683`) -------------------------------------------------------------------
  //
  // Two mutations on the citation index's gate, aimed at its two ways of being wrong. Both restore
  // a state the gate could plausibly have shipped in rather than inventing damage: the first is the
  // one-directional conformance check anybody writes first, the second is the bare green that `D683`
  // exists to forbid.
  {
    id: 'conformance-forgets-the-orphan-direction',
    milestone: 'm152a',
    pkg: ROOT_SUITE,
    file: 'scripts/gen-decisions.mjs',
    what: "the index stops noticing entries nothing cites. The missing direction is the one everybody writes, and on its own it looks complete — every citation resolves, so the gate is green and the reader is served. What it stops catching is the index GROWING: a block lifted from a private record, published, and referenced by no tracked prose is design-record text that reached a public commit without anyone reviewing it for publication, which is `D675`'s other half and the one with the irreversible failure",
    find: '    orphan: [...publishedIds].filter((id) => !citedIds.has(id)).sort(byId),',
    replace: '    orphan: [],',
  },
  {
    id: 'the-ci-tier-prints-the-green-it-did-not-earn',
    milestone: 'm152a',
    pkg: ROOT_SUITE,
    file: 'scripts/gen-decisions.mjs',
    what: "a runner with no design records stops announcing the tier it could not run. Nothing goes red — the two tracked tiers really did pass — so the ONLY signal that extraction fidelity was never checked is that sentence, and this deletes exactly it. `D527`'s false-completeness class in its purest form: a tier that silently does not run is indistinguishable from a tier that passed, and splitting the check in two (`D683`) was worth nothing unless the difference says itself out loud",
    edits: [
      ["      `  NOT CHECKED HERE: that each entry still matches the record it was lifted from. The design\\n` +\n", ""],
    ],
  },
  {
    id: 'the-fence-exemption-goes-blanket',
    milestone: 'm152b',
    pkg: ROOT_SUITE,
    file: 'scripts/verify-citations.mjs',
    what: "the bare-citation gate exempts EVERY fence instead of only the ones marked as tflw's own output. This is not a hypothetical: it is `D691` clause 2 exactly as first written, and against the real corpus it exempts ten genuine defects — eight of them `GRAMMAR.md` EBNF comments like `# inference (decision 22/M19)`, which are authored prose addressed to a reader, not a quotation of output. The generator had already learned the same lesson once; a blanket fence rule would have dropped 99 citations silently, in the milestone whose subject is citations nobody can follow",
    find: '      const skipLine = inProductFence || inScript;',
    replace: '      const skipLine = inProductFence || inScript || /^\\s*(```|~~~)/.test(ln);',
  },
  {
    id: 'the-wrapped-tail-flips-code-span-parity',
    milestone: 'm152b',
    pkg: ROOT_SUITE,
    file: 'scripts/verify-citations.mjs',
    what: "the inline-code exemption counts backticks across the joined wrap instead of the current line. The failure is SILENT and it was live for one commit: the tail is sliced at a fixed width, so a slice landing inside a code span leaves an odd number of backticks in front of the citation and the exemption swallows it. Nothing is reported — the gate simply goes green early, which is `D527`'s class arriving inside a gate written to end exactly that",
    find: '        if (inCodeSpan(own)) continue;',
    replace: '        if (inCodeSpan(before)) continue;',
  },
  {
    id: 'the-slug-hyphenates-before-it-deletes',
    milestone: 'm152c',
    pkg: ROOT_SUITE,
    file: 'scripts/github-slug.mjs',
    what: "GitHub's slug turns spaces into hyphens BEFORE deleting punctuation instead of after. The two steps look commutative and are not, and the order is the whole of `D693`'s six dead links: run this way, `(P#27\u201331)` keeps a separator and slugs to the `p27-31` every author who read the heading typed, instead of the `p2731` GitHub actually mints. Every one of those links was written by someone making exactly this mistake in their head. The unit tests below would not catch it on their own \u2014 a hand-written expectation agrees with a hand-written rule \u2014 which is why the corpus of GitHub's own anchors is what fails here",
    find: "  return text.toLowerCase().replace(DELETED, '').replace(/ /g, '-');",
    replace: "  return text.toLowerCase().replace(/ /g, '-').replace(DELETED, '');",
  },
  {
    id: 'a-mention-of-a-fragment-is-treated-as-an-address',
    milestone: 'm152c',
    pkg: ROOT_SUITE,
    file: 'scripts/verify-anchors.mjs',
    what: "the anchor gate matches `SPEC.md#\u2026` anywhere rather than only inside link syntax. This is the gate's first draft, and against the real tree it reported four findings that were all the same mistake in different costumes: `CONTRIBUTING.md` illustrating a fragment's SHAPE in backticks with an ellipsis where the middle would be, two script comments quoting one, and a synthetic link inside a test fixture. `verify-citations.mjs` paid for this lesson about citations (`D697`); a gate over addresses has the same hard job and it is not resolution, it is telling an address from a mention of one",
    find: "export const REFERENCE = /(?:https?:\\/\\/\\S*?blob\\/[^/\\s]+\\/SPEC\\.md|\\]\\([^)\\s]*SPEC\\.md)#([^)\\s\"'`<>\\]]+)/g;",
    replace: "export const REFERENCE = /SPEC\\.md#([^)\\s\"'`<>\\]]+)/g;",
  },
  {
    id: 'a-heading-collision-is-resolved-instead-of-refused',
    milestone: 'm152c',
    pkg: ROOT_SUITE,
    file: 'scripts/github-slug.mjs',
    what: "`anchorsOf` stops reporting collisions, so the gate silently accepts a link resolved by the one part of the rule nothing has verified. `SPEC.md` has no two headings that slug alike, so the pinned corpus \u2014 which is the only thing standing between this file and an approximation that agrees with itself \u2014 cannot vouch for the `-1`/`-2` suffix at all. Reporting the collision is what lets the gate refuse instead of passing a reader's link on the strength of a guess",
    find: '    if (anchor !== base) collisions.push({ ...heading, base, anchor });',
    replace: '    if (false) collisions.push({ ...heading, base, anchor });',
  },
  {
    id: 'the-pin-is-collected-but-never-merged',
    milestone: 'm152e',
    pkg: ROOT_SUITE,
    file: 'scripts/gen-decisions.mjs',
    what: "the index goes back to asking only this repository's prose what to publish. That is `D709`'s defect exactly \u2014 `testFlow-tests` cites 185 identifiers and 91 had entries, so a declaration sentence telling its readers the notation resolves in `DECISIONS.md` would have been false for the other 94. The failure is silent in the direction that matters: the entries simply stop being generated, and `--check` then reports them as orphans, which reads as *delete these*",
    find: '  const cited = mergeSiblingCitations(collectCitations(tracked), pin);',
    replace: '  const cited = collectCitations(tracked);',
  },
  {
    id: 'a-sibling-file-is-published-under-this-repositorys-name',
    milestone: 'm152e',
    pkg: ROOT_SUITE,
    file: 'scripts/gen-decisions.mjs',
    what: "a provenance line names `README.md` when the file is the SIBLING's `README.md`. Both repositories have one, and both have a `CONTRIBUTING.md`; the provenance line is the one thing in an entry that tells a reader where the citing prose lives, so an unqualified name does not merely lose precision, it sends them to a file that exists and says something else",
    find: '    for (const file of files) e.sites.push({ file: `${repo}/${file}`, line: 0 });',
    replace: '    for (const file of files) e.sites.push({ file, line: 0 });',
  },
  {
    id: 'the-label-rule-reaches-forward-from-any-bold-lead',
    milestone: 'm152e',
    pkg: ROOT_SUITE,
    file: 'scripts/gen-decisions.mjs',
    what: "the reach-forward stops being keyed on a single-line block, so a bold lead that already carries a sentence of its own also swallows the list under it. That publishes somebody else's enumeration as the decision's own content \u2014 the same over-taking `D670` refuses for headings, and the reason the rule was written narrowly enough to move exactly 3 entries of 585",
    find: '    if (j === start + 1 && /^\\s*\\*\\*/.test(lines[start])) {',
    replace: '    if (/^\\s*\\*\\*/.test(lines[start])) {',
  },
  {
    id: 'a-fenced-line-is-read-as-prose',
    milestone: 'm152d',
    pkg: '@tflw/docs-site',
    file: 'packages/docs-site/scripts/doc-blocks.mjs',
    what: "the notation rule reads fenced lines as prose. Two live security pages carry `# emitted by tflw M137d — sec/error-detail-disclosure` inside an `sh` fence: that is tflw's own output reproduced verbatim, not a citation aimed at anybody, and `D697` paid for the same distinction in the citation gate before this one existed. Run this way the guard reports a transcript as a defect, and the only repair available to whoever hits it is to falsify the transcript",
    find: '      if (fenced.has(n) || script.has(n)) return;',
    replace: '      if (script.has(n)) return;',
  },
  {
    id: 'an-exemption-outlives-the-page-it-describes',
    milestone: 'm152d',
    pkg: '@tflw/docs-site',
    file: 'packages/docs-site/scripts/doc-blocks.mjs',
    what: "`INCLUDED_RECORDS` skips a page by name without checking the page is still an `@include` stub. This is the mutation that turns `D706`'s decision back into the accident it was distinguished from: the exemption exists because `changelog.md` renders `CHANGELOG.md` verbatim and that record is declared and resolvable, so the moment the page grows prose of its own the reason stops being true — and skipping it anyway means a hand-written page is exempt from a rule about hand-written pages, silently, forever",
    find: "      if (!text.includes(`@include: ${record.include}`)) {",
    replace: '      if (false) {',
  },
  {
    id: 'the-notation-is-matched-case-insensitively',
    milestone: 'm152d',
    pkg: '@tflw/docs-site',
    // Moved in `M158c` (`D794`): the two citation classifiers became one, so the rule this mutation
    // breaks now lives beside the other seven in `scripts/citation-rules.mjs`. The suite that must
    // go red is still the docs-site one — that is where the property is asserted, and asserting it
    // where the rule now lives would move a docs-site guarantee into a file that has no view of a
    // GitHub anchor.
    file: 'scripts/citation-rules.mjs',
    what: "the decision pattern matches case-insensitively. Capitalisation is the whole reason this rule needs no URL-fragment exclusion: GitHub lowercases its heading anchors, so `SPEC.md#45-retries-d105-…` is an address and `D105` is a citation, and nothing but case tells them apart. `D691` clause 4 scoped an exclusion for this and measurement found it matched nothing — so the property is load-bearing and undefended by anything except the pattern's own flags",
    find: "  { what: 'a decision', re: /\\bD\\d{2,3}\\b/g },",
    replace: "  { what: 'a decision', re: /\\bD\\d{2,3}\\b/gi },",
  },
];
