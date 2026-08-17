// M137a (`M136c-01`) — the names another repository reads out of `findings.sarif`, written down
// once, in a form a machine can check across the repo boundary.
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
// `results.json` is **not** covered, and that is a scope decision rather than an oversight. The
// grader over there reads it through prose — `t.steps[].detail` matched with a regex — so its
// coupling is to sentences, not to keys, and a key manifest would assert nothing about it. If that
// grader ever starts reading structured fields, they belong here and this comment is the record that
// the question was asked.
//
// HOW IT CANNOT DRIFT. `sarif.ts` builds the document from these constants — every one of them is a
// computed key at its emit site, so a rename has to come through this file. `sarif.test.ts`'s
// contract test then walks a real emitted document and asserts the names present in it are these
// names, which catches the other direction: a contract that promises a key the emitter stopped
// writing. The consumer side is `testFlow-tests`' `scripts/verify-artifact-contract.mjs`, which
// reads `dist/artifact-contract.json` out of the installed package.

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
} as const;

export type ArtifactContract = typeof ARTIFACT_CONTRACT;
