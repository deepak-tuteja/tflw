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
    find: "  const unknown = flags.filter((f) => f !== '--list');",
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
];
