// M137a (`M136c-01`) — the names another repository reads out of `findings.sarif`, and since `M141`
// (`M137a-01`) out of `results.json` too, written down once, in a form a machine can check across
// the repo boundary.
//
// WHY THIS EXISTS. `testFlow-tests` consumes tflw's artifacts, and the two repositories are joined
// at exactly two seams. `TF0xx` assignment is the first, and it has a gate:
// `verify-check-diagnostics.mjs` reads the code list out of the *installed bundle*, so a code added
// here and not dogfooded there goes red in seconds. **The shape of a consumed artifact is the
// second seam, and it had no gate at all.**
//
// The break that filed the row: `M136a` renamed the field identifying a `tflw/notApplicable` entry
// from `rule` to `id`. `M136c` had been planned as "sequenced, not coupled — there is no coupled
// red, because no diagnostic code moves", and that was true and beside the point. No code moved;
// the SARIF grader over in `testFlow-tests` failed all eleven entries, with a message naming a field
// that no longer existed. It was found by running an acceptance phase, which is the slowest and most
// expensive way this could have been found, and D351's incantation was green throughout — correctly,
// because it was answering a different question.
//
// WHAT IS IN HERE, AND WHAT IS DELIBERATELY NOT. Only names **tflw invented and can therefore
// rename**. `ruleId`, `level`, `locations`, `suppressions` and `partialFingerprints` are SARIF
// 2.1.0's own vocabulary — a consumer that reads them is reading the standard, and this project
// renaming one is not a thing that can happen. What can happen is precisely what did: a `tflw/…`
// property, or a field inside a structure only this project defines, quietly changing spelling.
//
// `results.json` **is** covered, as of `M141` (`M137a-01`), and the previous version of this comment
// is why. It said `results.json` was out of scope because the grader over there read it through
// prose — `t.steps[].detail` matched with a regex — so the coupling was to sentences rather than to
// keys, and it ended: *if that grader ever starts reading structured fields, they belong here.* It
// had already started. `M134b` (D389) gave `RunReport` a structured `scanCoverage`, the same script
// read it for its census twenty lines above the regex, and the two answers to one question sat in
// one file for two milestones with nothing saying which was authoritative. `M141` deletes the prose
// half over there and this section is the other half of that trade.
//
// **The two artifacts spell one concept differently, and that is recorded rather than harmonised.**
// The field naming a stood-down rule is `id` in SARIF (`M136a` renamed it there, which is the break
// that filed `M136c-01` and created this file) and `rule` in `results.json`. Renaming either to
// match the other is a consumer-visible change for a cosmetic gain, so neither moves — but a reader
// who knows only one artifact will assume the other agrees, and this paragraph is what stops the
// next person from "fixing" the inconsistency by hand at one of the two emit sites.
//
// HOW IT CANNOT DRIFT. `sarif.ts` builds the document from these constants — every one of them is a
// computed key at its emit site, so a rename has to come through this file. `sarif.test.ts`'s
// contract test then walks a real emitted document and asserts the names present in it are these
// names, which catches the other direction: a contract that promises a key the emitter stopped
// writing. The consumer side is `testFlow-tests`' `scripts/verify-artifact-contract.mjs`, which
// reads `dist/artifact-contract.json` out of the installed package.
//
// **The `results` half is guarded by the walk alone, and that is measured rather than assumed.** Its
// keys are object-literal keys in `buildScanCoverage` (`cli.ts`) rather than computed ones, because
// the output is typed as `ScanRuleCensus` — a `@tflw/runtime` interface with fixed field names — so
// computing them here would put the authority in two places. The obvious objection is that `tsc`
// then makes the walk redundant. It does not, and `M141` ran the experiment rather than arguing it:
// renaming `rule` to `id` at the emit site alone fails `tsc` (TS2322), but renaming it *consistently*
// — the interface, `buildScanCoverage`, and both reporter consumers (`findings.ts`, `sarif.ts`) —
// **passes `typecheck` and `build` with zero errors** and is caught by nothing except the walk. That
// is `M136a`'s original break replayed on this artifact: a deliberate, internally coherent rename
// that a different repository's gate reads as a missing field.
//
// The walk is enough **only because it runs against a document the shipped binary actually wrote**:
// `e2e.test.ts`'s input-handling scan, whose fixture emits a `scanCoverage` with both a non-empty
// `applied` and a non-empty `notApplicable`. A walk over a hand-built fixture would be checking this
// file against a copy of itself, which is the shape of check `M141` exists to delete.

/**
 * `version` is the handshake. A consumer that understands version 1 and is handed a 2 should refuse
 * rather than guess, because the failure it is guarding against is precisely "the shape changed and
 * nothing said so" — reading a newer contract with older assumptions is that failure wearing the
 * gate's own clothes.
 */
export const ARTIFACT_CONTRACT = {
  version: 1,
  sarif: {
    /** Keys under `runs[].properties`. */
    runProperties: {
      notApplicable: 'tflw/notApplicable',
    },
    /** Fields of one entry in the `tflw/notApplicable` array. `id` is the one `M136a` renamed. */
    notApplicableFields: {
      kind: 'kind',
      scan: 'scan',
      id: 'id',
      because: 'because',
      count: 'count',
    },
    /** Keys under `runs[].results[].properties`. */
    resultProperties: {
      scan: 'tflw/scan',
      endpoint: 'tflw/endpoint',
      site: 'tflw/site',
      invariant: 'tflw/invariant',
      withheld: 'tflw/withheld',
      repro: 'tflw/repro',
      /** `M137c` (D437) — which discovery source reached the route, present only on a finding a
       *  `crawl` produced. Additive, so the contract version does not move: a consumer written
       *  against version 1 reads every key it knew about and ignores this one, which is exactly the
       *  compatibility this registry exists to make checkable. */
      via: 'tflw/via',
    },
    /** Keys under `runs[].tool.driver.rules[].properties`. `security-severity` is GitHub's name,
     * not ours, but we are the ones who decide whether to write it — and `M135a` recorded that it
     * must be a **string**, which is a fact about the value rather than the key and so lives in
     * `sarif-severity.ts` where the value is produced. */
    ruleProperties: {
      securitySeverity: 'security-severity',
    },
    /** The single key under `results[].partialFingerprints`. The container is SARIF's; the name
     * inside it is ours, and a baseline file is keyed on it (R8). */
    partialFingerprint: 'tflwFindingV1',
  },
  /**
   * `M141` (`M137a-01`) — the names another repository reads out of `results.json`. Additive, so
   * `version` does **not** move: the `via` precedent above applies unchanged, and a consumer written
   * against version 1 that knows only `sarif` reads every key it knew about and never looks here.
   *
   * Scoped to `scanCoverage` on purpose. `results.json` is the whole redacted `RunReport`, and most
   * of it — `ok`, `total`, `tests[]` — is read by everything from CI one-liners to the HTML
   * renderer, so listing all of it would turn this registry into a second copy of the type. What
   * belongs here is the part a *different repository's gate* reads and that this project can
   * therefore rename out from under it, which today is the stand-down census and nothing else.
   */
  results: {
    /** The key on the report root. Optional in the document — absent when a run had no scan at all,
     *  which `D404` keeps distinguishable from a scan that found nothing. */
    scanCoverage: 'scanCoverage',
    /** Fields of one `scanCoverage` entry (`ScanRuleCensus`). */
    scanCoverageFields: {
      scan: 'scan',
      applied: 'applied',
      notApplicable: 'notApplicable',
    },
    /** Fields of one entry in a census's `notApplicable` array.
     *
     *  **`rule`, not `id`** — the SARIF half above calls the same thing `id`. See the header: the
     *  two spellings are recorded rather than reconciled, and this is the one a `results.json`
     *  consumer must use. */
    notApplicableFields: {
      rule: 'rule',
      because: 'because',
    },
  },
  /**
   * `M160d` (`D834`) — how tflw rounds a duration before it reports one. The third thing another
   * repository reads out of these artifacts, and the first that is a *behaviour* rather than a
   * spelling.
   *
   * WHY A BEHAVIOUR BELONGS IN A NAME REGISTRY. The header's rule is "only names tflw invented and
   * can therefore rename", and the test it is really applying is *can this project change it out
   * from under a consumer's gate*. `testFlow-tests`' `derive-perf-bands.mjs` refuses to band a
   * rung's `p95Ratio` when tflw's reporting quantum is too large a share of the reading — an honest
   * suppression, and it computed that share from a hard-coded `QUANTUM_MS = 0.5` because tflw
   * reported whole milliseconds. `M160a` stopped doing that. Nothing went red: the sibling went on
   * suppressing bands using a quantum this project no longer had, which is `M136a`'s break exactly,
   * one artifact over and with arithmetic instead of a field name.
   *
   * Additive, so `version` does **not** move — the `via` and `results` precedents above apply
   * unchanged.
   *
   * INLINED LITERALS, NOT IMPORTED FROM `duration.ts`. That would be the single source of truth and
   * it is forbidden here for a reason external to this file: `packages/cli/scripts/bundle.mjs`
   * imports this module at build time precisely because it imports nothing, and warns that any
   * value-import transitively reaching `@tflw/runtime` corrupts the coverage measurement
   * (`browser.ts` 76/70 -> 143/90, global 95.19% -> 92.38%). So this is deliberately a *second*
   * statement of `D809`'s rule, and `artifact-contract.test.ts` compares it against the first by
   * walking the real `roundDurationMs` — the same shape as `sarif.test.ts`'s walk over an emitted
   * document, and what `verify-artifact-contract.mjs` means by "two independent statements of one
   * shape, compared".
   *
   * SCOPED TO WHAT THE SIBLING ACTUALLY READS. `D809`'s parameters (integer at or above 10,
   * two significant digits below it) are not published, because no consumer's gate reads them and
   * the header's warning about a registry outliving its last reader applies to a value as much as
   * to a key. A consumer needing per-value error rather than the bound is a reason to add them
   * then, with a witness.
   */
  durations: {
    /** The decision that fixes the rule, so a consumer's suppression note can cite it. */
    rule: 'D809',
    /**
     * The largest `|reported - true| / true` this rule can produce, over any positive duration.
     *
     * **Exactly `1/21`**, published rounded up. Both branches of `D809` reach it at the same place
     * and for the same reason: a value just under `1.05 x 10^k` renders down to `10^k`, having
     * crossed into a cell ten times wider than the one below it, so the error is `0.05 x 10^k`
     * against a value of `1.05 x 10^k`. The integer branch is the `k = 1` case of that.
     *
     * The number is asserted by the test, not transcribed from a plan — a hand-written bound would
     * be a third statement of a shape that already has two, and the only one nothing checks.
     */
    maxRelativeError: 0.0477,
  },
  /**
   * `M159g` (`D806d`) — the keys another repository reads out of `tflw spec --json`. **The fourth
   * thing, and the seam this file did not know it had.**
   *
   * `M141`'s entry above ends *"if that grader ever starts reading structured fields, they belong
   * here"*, about `results.json`. The same sentence was true of the spec manifest and nobody
   * noticed it come due: `testFlow-tests` has read `constructs[].id`, `.family`, `.status` and
   * `.name` structurally since `D752`, out of a document this project emits and can rename, with
   * nothing recording the dependency. Found while adding `phase` — a field that repository is about
   * to read — so it is closed in the milestone that would otherwise have deepened it.
   *
   * Additive, so `version` does **not** move: the `via`, `results` and `durations` precedents apply
   * unchanged, and a consumer written against version 1 that knows only `sarif` never looks here.
   *
   * **`SPEC_MANIFEST_VERSION` is the other half and is not duplicated here.** That number covers a
   * change to the manifest's *shape*; this registry covers the *spelling* of the fields inside it.
   * A consumer pins the first and reads the second, which is why publishing the version's value in
   * two places would create exactly the disagreement both mechanisms exist to prevent.
   */
  spec: {
    /** Root keys of the `tflw spec --json` document. */
    root: {
      manifest: 'manifest',
      constructs: 'constructs',
    },
    /** Fields of one entry in `constructs`, limited to what a consumer's gate reads. `group`,
     *  `syntax`, `summary` and `example` are emitted and deliberately unpublished — the header's
     *  warning about a registry outliving its last reader applies, and a gate that starts reading
     *  one is the reason to add it, with a witness. */
    constructFields: {
      id: 'id',
      family: 'family',
      status: 'status',
      name: 'name',
      /** `M159g`. Present on diagnostics only, so a consumer reading it must tolerate its absence
       *  elsewhere — which is why the walk asserts it on a diagnostic entry rather than on any. */
      phase: 'phase',
    },
  },
} as const;

export type ArtifactContract = typeof ARTIFACT_CONTRACT;
