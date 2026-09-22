// Which chapter owns which construct (`M233` `E`, `D1279`).
//
// `verify-docs.mjs` already asks *is this construct documented anywhere on the site*. That is a
// floor, and `M201`'s carry says a floor is blind in exactly one direction: a construct explained
// in a chapter a reader would never open is indistinguishable, to that gate, from one explained
// where it belongs. This table is the other half — **a construct is documented in the chapter that
// owns its subject** — and `verify-construct-homes.mjs` is what asserts it.
//
// WHY THE TABLE LIVES HERE AND NOT IN `spec-data.ts`. The plan specified an `owner` column beside
// `syntax`. Built, the column turned out to be the wrong shape in two ways, and both are recorded
// rather than quietly worked around:
//
//  1. **A home is a fact about this site, not about the language.** `spec-data.ts` is consumed by
//     the CLI, the language server and this site; a chapter path in it would couple the language
//     package to one consumer's file layout, and a chapter rename would edit the language.
//  2. **An owner is not always one chapter.** `browser-basics` and `browser-advanced` are two
//     chapters of ONE subject, split by depth rather than by topic. A single-chapter column would
//     have forced a false choice for all twenty-two browser steps, and the natural repair —
//     picking whichever chapter the step is currently in — is the gate grading its own input.
//
// So every home is a **set**, and every other docs-truth table in this repository already lives
// beside this one (`DECLARED_ROADMAP`, `DECLARED_UNCHECKED`, `DECLARED_UNDOCUMENTED` are all in
// `doc-blocks.mjs`). `homesAreComplete` below is what keeps `D1279`'s actual property — *a
// construct cannot be added without naming its home* — since it fails in both directions against
// the live manifest.
//
// HOW AN OWNER WAS CHOSEN. By asking what the construct *is*, from its own manifest row, and never
// by looking at where the site currently documents it. That distinction is the whole value of the
// gate: a table filled by reading the site can only ever agree with the site. Where the manifest
// already carries the answer it was taken — a step's `family`, a probe's own sentence — and where
// it does not, the summary was read and the subject named.

/** A subject, and the chapter or chapters that teach it. Chapters are guide paths without `.md`. */
const BROWSER = ['browser-basics', 'browser-advanced'];
const API_STEP = ['first-test', 'functional'];

/**
 * `id` → the chapters that own it. Grouped by the argument that decided each block, because a
 * table of 129 assignments with no reasons is a wordlist, and `verify-docs.mjs`'s docblock is
 * explicit that this project does not keep those.
 */
export const CONSTRUCT_HOMES = new Map(Object.entries({
  // ── declarations ────────────────────────────────────────────────────────────────────────────
  // A declaration is owned by the chapter that teaches the thing it declares.
  'declaration:test': ['first-test'],
  'declaration:crawl': ['crawling'],
  'declaration:action': ['actions'],
  'declaration:import': ['actions'],
  'declaration:use': ['actions'],
  'declaration:before': ['data-and-hooks'],
  'declaration:after': ['data-and-hooks'],
  // Headers on a declaration: each belongs to its own subject, not to "headers".
  'declaration:tags': ['ci-and-reporting'], //   `--tag` is a selection made when running
  'declaration:with-each': ['data-and-hooks'], // a row per case is what data-driven means
  'declaration:as': ['sessions'],
  'declaration:retry': ['retry-and-polling'],
  'declaration:concurrency': ['config'], //      a per-test override of the `workers` subject

  // ── steps ───────────────────────────────────────────────────────────────────────────────────
  // The manifest's own `family` is the owner for two of these blocks, and it is taken rather than
  // re-derived: a browser step is owned by the browser subject, a workload step by the load one.
  'step:api': API_STEP,
  'step:wait': ['retry-and-polling'],
  'step:expect': ['assertions'],
  'step:check': ['assertions'],
  'step:let': ['variables'],
  'step:capture': ['variables'],
  'step:log': ['debugging'],
  'step:give': ['actions'], //                   an action's return value; meaningless outside one
  'step:hold': ['load-testing'],
  'step:threshold': ['load-results'], //         the chapter is literally *Thresholds, results &
  //                                             validation*; a threshold is its whole subject
  'step:step': ['load-testing'],
  'step:spike': ['load-testing'],
  'step:run': ['load-testing'],
  'step:ramp': ['load-testing'],
  'step:pause': BROWSER, //                      `family: 'browser'` in the manifest, and the only
  //                                             construct in it whose one chapter is the load one
  'step:open': BROWSER, 'step:click': BROWSER, 'step:double': BROWSER, 'step:right': BROWSER,
  'step:fill': BROWSER, 'step:select': BROWSER, 'step:tick': BROWSER, 'step:untick': BROWSER,
  'step:press': BROWSER, 'step:hover': BROWSER, 'step:scroll': BROWSER, 'step:drag': BROWSER,
  'step:drop': BROWSER, 'step:download': BROWSER, 'step:screenshot': BROWSER, 'step:stub': BROWSER,
  'step:switch': BROWSER, 'step:close': BROWSER, 'step:accept': BROWSER, 'step:dismiss': BROWSER,
  'step:within': BROWSER,

  // ── subjects ────────────────────────────────────────────────────────────────────────────────
  // What an assertion is *about*. The api subjects are the assertions chapter's whole business;
  // the two that a scan reads are owned by the scan chapter as well, because that is where a
  // reader meets them.
  'subject:status': ['assertions'], 'subject:duration': ['assertions'],
  'subject:header': ['assertions'], 'subject:body': ['assertions'],
  'subject:body-text': ['assertions'], 'subject:body-bytes': ['assertions'],
  'subject:body-csv': ['assertions'], 'subject:body-pdf-text': ['assertions'],
  'subject:request': ['assertions'],
  'subject:response': ['assertions', 'security-scanning'],
  'subject:locator': BROWSER, 'subject:value': ['assertions'],
  'subject:page': BROWSER, 'subject:dialog-message': BROWSER, 'subject:dialog-type': BROWSER,
  'subject:network-request': BROWSER,

  // ── matchers ────────────────────────────────────────────────────────────────────────────────
  // A matcher is owned by the assertions chapter unless its `appliesTo` names a subject that
  // chapter does not teach — which is the manifest answering the question, not a preference.
  'matcher:equals': ['assertions'], 'matcher:contains': ['assertions'],
  'matcher:matches-regex': ['assertions'], 'matcher:matches-subset': ['assertions'],
  'matcher:matches-schema': ['assertions'], 'matcher:matches-file': ['assertions'],
  'matcher:greater-less-than': ['assertions'], 'matcher:has-count': ['assertions'],
  'matcher:connects': ['assertions'], 'matcher:fails': ['assertions'],
  'matcher:has-value': BROWSER, 'matcher:state-word': BROWSER,
  'matcher:was-made': BROWSER, 'matcher:has-no-a11y-violations': BROWSER,
  'matcher:matches-snapshot': BROWSER,
  'matcher:has-no-security-violations': ['security-scanning'],
  'matcher:has-no-authorization-violations': ['authorization-testing'],
  'matcher:has-no-input-handling-violations': ['input-handling'],

  // ── generators ──────────────────────────────────────────────────────────────────────────────
  // One subject, one chapter: generated values are what the variables chapter is for.
  'generator:random-string': ['variables'], 'generator:random-uuid': ['variables'],
  'generator:random-date': ['variables'], 'generator:random-of': ['variables'],
  'generator:random-like': ['variables'], 'generator:random-password': ['variables'],
  'generator:random-number': ['variables'],
  'generator:unique-number': ['variables'], 'generator:unique-uuid': ['variables'],
  'generator:unique-like': ['variables'], 'generator:unique-prefix': ['variables'],
  'generator:unique-email': ['variables'],
  'generator:transform-base64': ['variables'], 'generator:transform-hex': ['variables'],
  'generator:transform-url': ['variables'],

  // ── locators ────────────────────────────────────────────────────────────────────────────────
  // How you name an element. There is nowhere else this could be taught.
  'locator:button': BROWSER, 'locator:field': BROWSER, 'locator:list': BROWSER,
  'locator:text': BROWSER, 'locator:css': BROWSER, 'locator:xpath': BROWSER,

  // ── config ──────────────────────────────────────────────────────────────────────────────────
  // A config key is owned by the chapter that teaches the thing it configures, NOT by the config
  // chapter because it happens to be spelled in `tflw.config`. That distinction is what the first
  // draft of this round got wrong about `teardown`, in the other direction.
  'config:directive:defaults': ['config'], 'config:directive:env': ['config'],
  'config:directive:require': ['config'], 'config:directive:exclude': ['config'],
  'config:directive:session': ['sessions'],
  'config:key:header': ['config'], 'config:key:timeout': ['config'],
  'config:key:workers': ['config'], 'config:key:web': ['config'], 'config:key:api': ['config'],
  'config:key:insecure': ['config'], 'config:key:cert': ['config'], 'config:key:key': ['config'],
  'config:key:report': ['ci-and-reporting'], //    which artifacts a run writes, and where
  'config:key:allow': ['ci-and-reporting'], //     the safety half of that chapter's own title
  'config:key:evidence': ['ci-and-reporting'], //  how much of a request the report keeps
  'config:key:redact': ['ci-and-reporting'], //    what never reaches a report or a log
  'config:key:log': ['ci-and-reporting'], //       how much the run says, and where
  'config:key:teardown': ['load-testing'], //      workload-only, and the manifest says so
  'config:key:viewport': BROWSER, //               the window every browser test starts at
  'config:key:authorized': ['security-scanning'], // written permission the scans require
  'config:key:baseline': ['findings-and-baselines'],
  // A probe flag permits one scan family's payloads, so it is owned by that family's chapter.
  'config:probe:mutating': ['authorization-testing'],
  'config:probe:oversized': ['input-handling'],
  'config:probe:traversal': ['input-handling'],
  'config:probe:ciphers': ['security-scanning'],
}));

/**
 * The table against the live manifest, both ways — which is `D1279`'s actual property. A table
 * that merely *has* entries is satisfied by a stale one; a construct added to the language with no
 * home here fails, and a home naming a construct the language no longer has fails too.
 */
export function homesAreComplete(constructs) {
  const problems = [];
  const live = new Set();
  for (const c of constructs) {
    if (c.family === 'diagnostic') continue; // held by diagnosticsCoverage.test.ts already
    live.add(c.id);
    if (!CONSTRUCT_HOMES.has(c.id)) {
      problems.push(`\`${c.id}\` is a shipped construct with no home — add it to CONSTRUCT_HOMES, naming the chapter that teaches its subject rather than the one it currently appears in`);
    }
  }
  for (const id of CONSTRUCT_HOMES.keys()) {
    if (!live.has(id)) problems.push(`CONSTRUCT_HOMES names \`${id}\`, which is not a shipped construct — delete it`);
  }
  return problems;
}
