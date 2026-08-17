// M97a (`PLAN_M97_CHECKER_CONTRACT.md`, D138) — the enumerated set of rules the *runtime* enforces,
// so that "the checker decides every runtime rule that is decidable from the AST" (D137 clause 2) is
// a checkable claim rather than a slogan.
//
// D137 states the checker's contract as two-way conformance with the runtime:
//
//   1. Soundness — if `tflw check` reports an error, `tflw run` would have failed on that rule.
//   2. Completeness where decidable — if the runtime enforces a rule and it is decidable from the
//      AST, the checker decides it first.
//   3. The carve-out — rules needing I/O are excluded from the `lang` *package*, not from the
//      `tflw check` *command* (D144).
//
// Clause 2 is only meaningful if "the rules the runtime enforces" is an enumerated set. This is it.
//
// It is a coverage floor, not a correctness proof — the same philosophy as `grammarCoverage.test.ts`
// and `diagnosticsCoverage.test.ts` (M86), whose comment states it best: it "cannot tell a right
// explanation from a wrong one, only a *written* one from a missing one. That is the failure mode
// that actually occurs: nobody writes a wrong row, they forget to write one." A `'static'` row may
// legitimately carry a `filedRow` instead of a `checkerCode`; that is what lets this manifest ship
// green *today* while still being a machine-checked ledger of what the checker still owes.
//
// `conformance.test.ts` enforces three things against this table:
//   - every `throw new RuntimeError(` site under `packages/runtime/src` is described by a row;
//   - every row still matches the number of sites it claims (so a deleted throw fails too);
//   - every `'static'` row carries a `checkerCode` in `Codes`, or a `filedRow`, or both.
//
// ## Two corrections to D138, from doing the enumeration
//
// **Scope: the whole runtime package, not `interpreter.ts`.** D138 specified a scan of
// `interpreter.ts` on the strength of a triage that found 9 rules there. The real distribution is
// **104 sites across 13 files**, and `interpreter.ts` holds 45 of them. Scanning only that file
// would have left `matcher.ts` permanently unclassified — the one file that holds D140's actual
// subject, including both sides of the kind/shape line D140 turns on (`matcher … is only valid on a
// \`request\` subject` is kind and static; `\`contains\` expects a string or array subject` is shape
// and cannot be). A manifest that omits the file the next milestone is about is not a manifest.
//
// **Vocabulary: six values, not three.** D138 proposed `'static' | 'needs-response' | 'needs-io'`.
// Against all 104 sites that under-describes in three ways, each of which would have forced a wrong
// answer somewhere:
//
//   - `'needs-response'` is the wrong name for `env(FOO)` being unset or for division by zero.
//     Those need evaluated *values*, which need not come from a response. Renamed `'needs-values'`.
//   - A large class is decidable *only when the operands are literal* — `random number 5 to 1`,
//     `hex decode("zz")`, a regex operand. Calling these `'static'` over-claims and invites exactly
//     the clause 1 violation `A4-05` already is; calling them `'needs-values'` hides real checkable
//     rules. `'static-if-literal'` names the `undefined`-vs-`[]` doctrine D144 already relies on:
//     not knowable ≠ known-bad, so the checker decides the literal case and skips the interpolated
//     one.
//   - Some throws are not rules at all. `'propagation'` re-raises an inner step/hook/action failure
//     and carries no rule of its own; `'internal'` guards an invariant only a tflw bug can violate.
//     Classifying either as `'static'` would demand a checker rule for a message no suite can
//     provoke.
//
// ## What the enumeration found
//
// Beyond the rows the plan's triage already named, the full pass surfaced further unfiled rule-2
// violations — statically decidable rules the runtime enforces and the checker does not. They carry
// `filedRow: 'M97a-NN'` and are recorded in `REVIEW_FINDINGS.md` under M97a. Per D145 this row list
// is M97a's real output: it is what sizes `M97b`/`M97c`/`M97d`.

/**
 * How much a rule needs to know before it can be decided.
 *
 * Only `'static'` obliges the checker under D137 clause 2. Everything else records *why* the rule is
 * the runtime's to keep, so that the answer is written down once rather than re-derived per reader.
 */
export type Decidability =
  /** Decidable from the AST plus `tflw.config` alone. The checker owes this one. */
  | 'static'
  /**
   * Decidable when the relevant operands are literals, and skipped when they are interpolated —
   * `random number 5 to 1` is knowably wrong, `random number {lo} to {hi}` is not knowable at all.
   * The checker owes the literal case only (the `undefined`-vs-`[]` doctrine, D144).
   */
  | 'static-if-literal'
  /** Needs evaluated runtime values — a response body, a captured/`let` binding, an env var. */
  | 'needs-values'
  /** Needs the filesystem, the network, a browser, or an optional peer dependency. */
  | 'needs-io'
  /** Re-raises an inner step/hook/action failure; carries no rule of its own. */
  | 'propagation'
  /** An invariant only a tflw bug can violate. Never a user-facing rule. */
  | 'internal';

export interface RuntimeRule {
  /** Stable, human-readable id. Referenced by REVIEW_FINDINGS rows and by M97b/c/d. */
  id: string;
  /** Source file under `packages/runtime/src` that throws it. Documentation, not a key. */
  file: string;
  /**
   * A literal substring of the thrown message *as written in the source*, unique to this rule.
   *
   * Deliberately not a line number: M96 moved five of the sites the M97 plan cites by 7-39 lines
   * apiece, so a line-keyed manifest would have been stale before it was written.
   */
  excerpt: string;
  /** How many sites carry this exact rule. Defaults to 1; several are thrown from two paths. */
  sites?: number;
  /**
   * Match the argument text in full rather than as a substring.
   *
   * Needed where one rule's whole message is a substring of another's: `step-failed` throws exactly
   * `exec.error ?? 'a step failed'`, and `action-failed` embeds that same fallback inside its own
   * template. No excerpt can separate them, so the shorter one is anchored instead.
   */
  exact?: boolean;
  decidable: Decidability;
  /** The diagnostic that decides this rule statically today. */
  checkerCode?: string;
  /**
   * The `REVIEW_FINDINGS.md` row tracking the gap. Present on a `'static'` row means the checker
   * does *not* yet decide it. Present *alongside* a `checkerCode` means it decides it only
   * partially — `TF035` vs. the runtime's imported-duplicate case (D143 half 1) is the live example.
   */
  filedRow?: string;
  /** Why this rule is not the checker's, or what the checker still owes on it. */
  note?: string;
}

export const RUNTIME_RULES: readonly RuntimeRule[] = [
  // -- a11y.ts ---------------------------------------------------------------
  {
    id: 'a11y-axe-core-missing',
    file: 'a11y.ts',
    excerpt: "`axe-core` peer dependency isn't installed",
    decidable: 'needs-io',
    note: 'optional peer dependency resolution — the checker cannot know what is installed where the run will happen',
  },

  // -- binary-match.ts -------------------------------------------------------
  {
    id: 'matches-file-unreadable',
    file: 'binary-match.ts',
    excerpt: 'for \\`matches file\\`',
    decidable: 'static-if-literal',
    filedRow: 'A4-07',
    note: 'the read stays runtime (a file can vanish between check and run), but *existence* of a literal path is decidable — D144, implemented in M97c',
  },

  // -- browser.ts ------------------------------------------------------------
  {
    id: 'browser-playwright-missing',
    file: 'browser.ts',
    excerpt: "`playwright` peer dependency isn't installed",
    decidable: 'needs-io',
    note: 'as above — optional peer dependency resolution',
  },
  {
    id: 'browser-unknown-tab',
    file: 'browser.ts',
    excerpt: 'tab(s) currently open',
    decidable: 'needs-values',
    note: 'how many tabs are open depends on what the run did',
  },
  {
    id: 'browser-close-only-tab',
    file: 'browser.ts',
    excerpt: "can't close tab",
    decidable: 'needs-values',
    note: 'as above',
  },
  {
    id: 'browser-locator-no-element',
    file: 'browser.ts',
    excerpt: 'no element found for',
    decidable: 'needs-io',
    note: 'needs a live DOM',
  },
  {
    id: 'browser-step-failed',
    file: 'browser.ts',
    excerpt: '${label} failed: ${firstLine}',
    decidable: 'propagation',
    note: 're-raises a Playwright failure under the step label',
  },

  // -- contract.ts -----------------------------------------------------------
  {
    id: 'openapi-unfetchable',
    file: 'contract.ts',
    excerpt: 'could not load OpenAPI document at',
    decidable: 'needs-io',
    note: 'network fetch of the contract document',
  },
  {
    id: 'openapi-no-schemas',
    file: 'contract.ts',
    excerpt: 'to validate against',
    decidable: 'needs-io',
    note: 'needs the fetched document',
  },
  {
    id: 'openapi-schema-not-found',
    file: 'contract.ts',
    excerpt: 'not found in',
    decidable: 'needs-io',
    note: 'needs the fetched document',
  },

  // -- csv-parse.ts ----------------------------------------------------------
  {
    id: 'body-csv-ragged-row',
    file: 'csv-parse.ts',
    excerpt: 'body csv: row',
    decidable: 'needs-values',
    note: 'the response body is the input',
  },

  // -- dataTable.ts ----------------------------------------------------------
  {
    id: 'data-table-unreadable',
    file: 'dataTable.ts',
    excerpt: 'could not read data table file',
    decidable: 'static-if-literal',
    filedRow: 'A4-07',
    note: 'existence of a literal `with each from` path is decidable — D144, M97c',
  },
  {
    id: 'data-table-bad-extension',
    file: 'dataTable.ts',
    excerpt: 'must be \\`.csv\\` or \\`.json\\`',
    decidable: 'static',
    checkerCode: 'TF056',
    filedRow: 'M97a-01',
    note: 'M124/D233 — the extension of a literal path is pure string inspection, no I/O at all. Its own code rather than `TF043`: `TF043` is `MISSING_FILE`, and here the file is very likely there, which is what leaves the extension as the only thing wrong. Different tiers too — a missing file may be created by an earlier step (D147, warning), an extension cannot change between check and run (error)',
  },
  {
    id: 'data-table-invalid-json',
    file: 'dataTable.ts',
    excerpt: 'is not valid JSON',
    decidable: 'needs-io',
    note: 'needs the file contents — the same reason D144 deletes the CSV *column* half of the SPEC claim',
  },
  {
    id: 'data-table-not-array',
    file: 'dataTable.ts',
    excerpt: 'must be a JSON array of row objects',
    decidable: 'needs-io',
    note: 'needs the file contents',
  },
  {
    id: 'data-table-row-not-object',
    file: 'dataTable.ts',
    excerpt: 'must be a JSON object',
    decidable: 'needs-io',
    note: 'needs the file contents',
  },
  {
    id: 'data-table-ragged-row',
    file: 'dataTable.ts',
    excerpt: 'matching the heade',
    decidable: 'needs-io',
    note: 'needs the file contents',
  },

  // -- eval.ts ---------------------------------------------------------------
  {
    id: 'env-var-not-set',
    file: 'eval.ts',
    excerpt: 'is not set (referenced by env(',
    decidable: 'needs-io',
    note: 'the process environment of the run, not of the check',
  },
  {
    id: 'format-needs-date',
    file: 'eval.ts',
    excerpt: '\\`format … as …\\` needs a date value',
    decidable: 'needs-values',
    note: 'the formatted value may come from a capture',
  },
  {
    id: 'random-number-range',
    file: 'eval.ts',
    excerpt: 'random number ${from} to ${to}',
    decidable: 'static-if-literal',
    checkerCode: 'TF054',
    filedRow: 'M97a-02',
    note: 'M124/D232 — `random number 5 to 1` is decidably empty when both bounds are literal, and `random number {lo} to {hi}` is not decidable at all, which is what `static-if-literal` names. The row stays for the interpolated half this throw keeps',
  },
  {
    id: 'random-decimal-range',
    file: 'eval.ts',
    excerpt: 'random decimal ${from} to ${to}',
    decidable: 'static-if-literal',
    checkerCode: 'TF054',
    filedRow: 'M97a-02',
    note: 'M124/D232 — as above, same rule and same code',
  },
  {
    id: 'random-password-length',
    file: 'eval.ts',
    excerpt: 'random password ${length}',
    decidable: 'static-if-literal',
    checkerCode: 'TF054',
    filedRow: 'M97a-02',
    note: 'M124/D232 — a literal length below 4 is decidable. Note the asymmetry this milestone measured and did NOT close: `random string 0` throws nothing at all (`M124-02`), so there is no runtime rule here for a checker to predict',
  },
  {
    id: 'eval-invalid-reference',
    file: 'eval.ts',
    excerpt: 'invalid reference',
    decidable: 'internal',
    note: 'the parser cannot produce a reference whose first segment is not a prop',
  },
  {
    id: 'unknown-variable',
    file: 'eval.ts',
    excerpt: 'unknown variable',
    decidable: 'static',
    checkerCode: 'TF030',
    filedRow: 'A4-04',
    note: 'decided by `checkUnknownVariables` for tests and hooks — but *not* for `session` bodies, which receive one of the twelve passes (D142, M97b)',
  },
  {
    id: 'eval-prop-of-non-object',
    file: 'eval.ts',
    excerpt: 'cannot read \\`.${seg.name}\\` of',
    decidable: 'needs-values',
    note: 'shape of a runtime value',
  },
  {
    id: 'eval-index-non-array',
    file: 'eval.ts',
    excerpt: 'cannot index [${seg.index}] into',
    decidable: 'needs-values',
    note: 'shape of a runtime value',
  },
  {
    id: 'eval-date-minus-duration',
    file: 'eval.ts',
    excerpt: 'between a date and a duration',
    decidable: 'needs-values',
    note: 'operand types are only known once evaluated',
  },
  {
    id: 'eval-division-by-zero',
    file: 'eval.ts',
    excerpt: 'division by zero',
    decidable: 'needs-values',
    note: 'the divisor is usually a capture; a literal `/ 0` is conceivable but the parser has no constant folding to hang it on',
  },
  {
    id: 'eval-bad-operand-types',
    file: 'eval.ts',
    excerpt: "cannot apply '${op}' to",
    decidable: 'needs-values',
    note: 'operand types are only known once evaluated',
  },
  {
    id: 'eval-expects-number',
    file: 'eval.ts',
    excerpt: 'expects a number, got ${describe(v)}',
    decidable: 'needs-values',
    note: 'the value is evaluated first',
  },
  {
    id: 'eval-expects-date',
    file: 'eval.ts',
    excerpt: 'expected a date (today/now',
    decidable: 'needs-values',
    note: 'the value is evaluated first',
  },
  {
    id: 'url-decode-invalid',
    file: 'eval.ts',
    excerpt: 'url decode(...)',
    decidable: 'static-if-literal',
    checkerCode: 'TF054',
    filedRow: 'M97a-03',
    note: 'M124/D232 — a literal argument is decidable; an interpolated one is skipped. **The site `M97a-03` does not name**: the row accounts for two, and probing found three. The checker shares `isDecodablePercentEncoding` with this throw rather than restating it (D233)',
  },
  {
    id: 'hex-decode-invalid',
    file: 'eval.ts',
    excerpt: 'hex decode(...)',
    decidable: 'static-if-literal',
    checkerCode: 'TF054',
    filedRow: 'M97a-03',
    note: 'M124/D232 — as above, and the clause nobody remembers is the odd-length one, which is exactly why `isDecodableHex` is imported rather than re-derived',
  },
  {
    id: 'base64-decode-invalid',
    file: 'eval.ts',
    excerpt: 'base64 decode(...)',
    decidable: 'static-if-literal',
    checkerCode: 'TF054',
    filedRow: 'M97a-03',
    note: 'M124/D232 — as above. `isDecodableBase64` rejects the URL-safe `-`/`_` alphabet that `Buffer.from` accepts, so a re-derived checker copy would report `TF054` on a program that runs',
  },

  // -- http.ts / httpPinned.ts -----------------------------------------------
  {
    id: 'http-request-timeout',
    file: 'http.ts',
    excerpt: 'request timed out after',
    sites: 2,
    decidable: 'needs-io',
    note: 'the network',
  },
  {
    id: 'http-request-failed',
    file: 'http.ts',
    excerpt: 'fetchErrorHint(err, opts.url)',
    sites: 2,
    decidable: 'needs-io',
    note: 'the network',
  },
  {
    id: 'http-pinned-request-failed',
    file: 'httpPinned.ts',
    excerpt: 'fetchErrorHint({ cause: err }, opts.url)',
    sites: 2,
    decidable: 'needs-io',
    note: 'the network, under a pinned-certificate agent',
  },

  // -- interpreter.ts --------------------------------------------------------
  {
    id: 'unknown-session',
    file: 'interpreter.ts',
    excerpt: 'unknown session',
    sites: 2,
    decidable: 'static',
    checkerCode: 'TF028',
    note: 'sessions are declared in `tflw.config`, which the checker reads',
  },
  {
    id: 'session-establish-failed',
    file: 'interpreter.ts',
    excerpt: 'failed to establish',
    sites: 2,
    decidable: 'propagation',
    note: 're-raises whatever the session body failed on',
  },
  {
    id: 'before-hook-failed',
    file: 'interpreter.ts',
    excerpt: "a \\`before\\` hook failed",
    decidable: 'propagation',
    note: 're-raises whatever the hook body failed on',
  },
  {
    id: 'step-failed',
    file: 'interpreter.ts',
    excerpt: "exec.error ?? 'a step failed'",
    exact: true,
    decidable: 'propagation',
    note: "anchored: this whole message is a substring of `action-failed`'s",
  },
  {
    id: 'after-hook-failed',
    file: 'interpreter.ts',
    excerpt: "an \\`after\\` hook failed",
    decidable: 'propagation',
    note: 're-raises whatever the hook body failed on',
  },
  {
    id: 'load-run-without-workload',
    file: 'interpreter.ts',
    excerpt: 'no workload-bearing \\`test\\`',
    decidable: 'static',
    checkerCode: 'TF033',
    note: 'the workload clause is in the AST',
  },
  {
    id: 'merge-shards-empty',
    file: 'interpreter.ts',
    excerpt: '\\`mergeLoadShardReports\\` needs at least one',
    decidable: 'internal',
    note: 'an internal API precondition, unreachable from any suite',
  },
  {
    id: 'duplicate-action',
    file: 'interpreter.ts',
    excerpt: 'duplicate action',
    decidable: 'static',
    checkerCode: 'TF035',
    note: 'Closed by M97b (D143 half 1). Was the live example of a code and a filed row on one row: `TF035` existed but saw only the same-file half, while this throw refuses the imported duplicate too. `B5-02`\'s halves 2 and 3 are about `refactor apply`, not this rule, and stay open under that row',
  },
  {
    id: 'import-unreadable',
    file: 'interpreter.ts',
    excerpt: 'could not read imported file',
    decidable: 'static-if-literal',
    filedRow: 'A4-07',
    note: 'existence of a literal `import` path is decidable — D144, M97c',
  },
  {
    id: 'import-parse-errors',
    file: 'interpreter.ts',
    excerpt: 'has parse errors',
    decidable: 'needs-io',
    note: 'needs the imported file read; `resolveImportedActions` already does this during `tflw check`, so the *diagnostics* surface — this throw is the run-time residue',
  },
  {
    id: 'use-module-unloadable',
    file: 'interpreter.ts',
    excerpt: 'could not load JS helper module',
    decidable: 'static-if-literal',
    filedRow: 'A4-07',
    note: 'existence of a literal `use` path is decidable — D144, M97c',
  },
  {
    id: 'duplicate-helper-export',
    file: 'interpreter.ts',
    excerpt: 'duplicate JS helper export',
    decidable: 'needs-io',
    note: "needs the module's exports, which needs importing it",
  },
  {
    id: 'browser-manager-missing',
    file: 'interpreter.ts',
    excerpt: 'no browser support was initialized',
    decidable: 'internal',
    note: 'its own message says `internal:` — reachable only by calling `runProgram` wrongly',
  },
  {
    id: 'no-web-base-url',
    file: 'interpreter.ts',
    excerpt: 'no \\`web\\` base URL is configured',
    decidable: 'static',
    checkerCode: 'TF051',
    note: 'M116/D148 — both halves are static: the AST says whether a browser step exists, `tflw.config` says whether the active env declares `web`',
  },
  {
    id: 'mask-without-snapshot',
    file: 'interpreter.ts',
    excerpt: '\\`mask <locator>\\` only applies alongside',
    decidable: 'static',
    checkerCode: 'TF052',
    note: 'M116/D149 — masks and the matcher sit in the same `ExpectStmt`, so the rule is one boolean over one node',
  },
  {
    id: 'call-arity',
    file: 'interpreter.ts',
    excerpt: 'argument(s), got',
    decidable: 'static',
    checkerCode: 'TF038',
    note: 'under `checkCalls`’ closed-world condition',
  },
  {
    id: 'action-failed',
    file: 'interpreter.ts',
    excerpt: 'renderActionFailure(path, inner.root), path, inner.root',
    decidable: 'propagation',
    note: 'D141: was `action "${call.name}" failed: ${exec.error}` — prefixing its own caller\'s already-prefixed string, unbounded, which is what turned one failing step into a 14,505-character line at 671 frames. M97d made the frames an array and renders the string once, elided past 6',
  },
  {
    id: 'call-cycle',
    file: 'interpreter.ts',
    excerpt: 'an action that reaches itself never terminates',
    decidable: 'static',
    checkerCode: 'TF044',
    note: 'D141 shipped `TF044` same-file only and left the cross-file case to this guard; M109 (`M97d-01`, now closed) gave `KnownAction` a body, so the checker decides that case too whenever the imports resolve. What is left here is genuinely undecidable statically and so is exactly what clause 2 excludes: an import that cannot be read or parsed, a cycle whose every call site is inside imported files (no span in the file being checked), and `runProgram` driven as a library with no check pass in front of it. Detecting a repeat on the live call stack rather than counting to a depth limit is what lets both halves name the same cycle in the same notation',
  },
  {
    id: 'unknown-call',
    file: 'interpreter.ts',
    excerpt: 'unknown call',
    decidable: 'static',
    checkerCode: 'TF037',
    filedRow: 'A4-04',
    note: 'decided for tests; a call in a `session` body can *never* resolve (the session registry is empty by construction) and is checked nowhere — D142, M97b',
  },
  {
    id: 'mtls-material-unreadable',
    file: 'interpreter.ts',
    excerpt: 'could not read mTLS',
    decidable: 'needs-io',
    note: 'paths come from `tflw.config`, not the AST; outside D144’s enumerated scope',
  },
  {
    id: 'body-from-unreadable',
    file: 'interpreter.ts',
    excerpt: 'could not read \\`body from\\` file',
    decidable: 'static-if-literal',
    filedRow: 'A4-07',
    note: 'existence of a literal `body from` path is decidable — D144, M97c',
  },
  {
    id: 'upload-unreadable',
    file: 'interpreter.ts',
    excerpt: 'could not read \\`upload\\` file',
    decidable: 'static-if-literal',
    filedRow: 'A4-07',
    note: 'existence of a literal `upload` path is decidable — D144, M97c',
  },
  {
    id: 'hold-exceeds-wait-timeout',
    file: 'interpreter.ts',
    excerpt: 'can never be satisfied',
    decidable: 'static',
    checkerCode: 'TF055',
    filedRow: 'M97a-06',
    note: 'M124/D232 — the hold duration is a literal in the AST and `timeouts.wait` is in `tflw.config`; the runtime already phrases it as a never-satisfiable program, which is a checker sentence. `TF055` is a **warning** while this stays a hard error, and the split is D147: the checker compares against one resolved env, so it predicts, and a suite whose CI env raises `timeout wait` must stay runnable',
  },
  {
    id: 'quantifier-vs-request-to',
    file: 'interpreter.ts',
    excerpt: '\\`any\\`/\\`all\\` are not supported against a \\`request to',
    decidable: 'static',
    checkerCode: 'TF010',
    note: 'Already decided, and `M97a-07` was wrong to say otherwise — M97b withdrew it. The *parser* rejects this via `quantifiable()` before the checker ever runs (`expect any request to "…" was made` is `TF010`), and the AST comment on `quantifiable` says as much: the parser rejects, and `evaluateQuantified` re-asserts the same triple at run time. Filing it as an unchecked gap read the throw as evidence of absence. A runtime throw for a rule the parser already enforces is defence in depth, not a hole',
  },
  {
    id: 'matcher-vs-request-to',
    file: 'interpreter.ts',
    excerpt: "isn't valid against \\`request to",
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'matcher × subject kind. `TF031` covers two *other* request rules (inside `wait until api`, and combining with `connects`/`fails`) — not this one',
  },
  {
    id: 'body-path-of-request-not-json',
    file: 'interpreter.ts',
    excerpt: 'a \\`body.<path> of request to',
    decidable: 'needs-values',
    note: 'whether the recorded response was JSON',
  },
  {
    id: 'subject-vs-of-request-to',
    file: 'interpreter.ts',
    excerpt: 'does not support \\`of request to',
    decidable: 'static',
    filedRow: 'M97a-09',
    note: 'subject kind × modifier, both in the AST — named in the M97 plan triage as unfiled',
  },
  {
    id: 'matcher-vs-page',
    file: 'interpreter.ts',
    excerpt: "isn't valid against \\`page\\`",
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'matcher × subject kind; folded into D140’s pass in M97b',
  },
  {
    id: 'capture-found-nothing',
    file: 'interpreter.ts',
    excerpt: 'nothing to capture at',
    decidable: 'needs-values',
    note: 'whether the response carried the path',
  },
  {
    // M137b (D433/D456) — `csrf from <subject> send as header "<name>"`, when the establishment
    // response carries nothing at that subject. Its sibling row above is the precedent in full: same
    // question, same answer, and this manifest is where D456's reasoning was independently confirmed.
    // D443 wanted a diagnostic code for this throw; asking *this* row's question — can the checker
    // decide it — gives the same answer the plan arrived at from the other direction. The checker
    // decides the half that is static (`csrf from` with no request before it, which is `TF039` via
    // `checkResponseScopeInSteps`) and this row keeps the half that needs the response.
    id: 'csrf-token-found-nothing',
    file: 'interpreter.ts',
    excerpt: 'no CSRF token at',
    decidable: 'needs-values',
    note: 'whether the establishment response carried the token; the no-request-at-all half is TF039',
    checkerCode: 'TF039',
  },
  {
    id: 'matches-file-body-bytes-only',
    file: 'interpreter.ts',
    excerpt: '\\`matches file\\` is only valid on a',
    decidable: 'needs-values',
    
    note: 'matcher × subject kind. M96’s D132 deliberately widened this to admit the value subject, which is why D145 sequences M96 before this manifest — the row would otherwise have been written and immediately rewritten',
  },
  {
    id: 'quantifier-vs-subject',
    file: 'interpreter.ts',
    excerpt: '\\`any\\`/\\`all\\` only apply to a',
    decidable: 'static',
    checkerCode: 'TF010',
    note: 'the one rule already enforced in both places — `parser.ts` rejects it via `badQuantifier`, sharing M96’s `quantifiable()` predicate. The pattern this milestone generalises; it was applied once and never asked about again',
  },
  {
    id: 'no-response-yet',
    file: 'interpreter.ts',
    excerpt: 'no response yet',
    sites: 5,
    decidable: 'static',
    checkerCode: 'TF039',
    note: 'ordering within a step sequence is in the AST. M128b added the third site: `execSecurityExpect` needs an observed response for the same reason `status` does, and `readsResponse` lists `ResponseSubject` so `TF039` already decides it. M130b added the fourth, `execAuthzExpect`, for the identical reason and with no new rule — the two scan matchers share one subject and therefore one precondition. M134a added the fifth, `execInputHandlingExpect`, and it is the first that needs the observed **request** as well as the response, since it mutates one input of it and re-sends — still `TF039`, because a subject that has no response has no request either',
  },
  {
    // M130b (D329). **Not a `'static'` row with a filed gap, and not a duplicate of `TF063`
    // either.** The checker decides this for a `test` body and a `before file` hook, which is
    // everything it can see; what reaches here is the half it structurally cannot — an assertion
    // inside an `action`, whose executing test is bound at run time against the entry file's
    // registry (`checker.ts:885` already draws that line for call resolution). So the rule *is*
    // decided statically wherever it is decidable, and this site covers the residue.
    id: 'authz-assertion-no-owner',
    file: 'interpreter.ts',
    excerpt: 'needs an owner, and the running test declares none',
    decidable: 'needs-values',
    checkerCode: 'TF063',
    note: 'D329’s two halves. The checker refuses a `test` with no `as <session>` and a `before file` hook; this backstop catches the same assertion written inside an `action`, where the owner is a late-bound fact. One policy, applied at the two layers that can each see part of it',
  },
  {
    // M130b (D328). Same shape one rule over, and this half is a *comparison*: what the request
    // actually carried, against what the owning sessions contributed as of that request. Both
    // operands are known at run time and only one of them is knowable statically.
    id: 'authz-step-names-own-credential',
    file: 'interpreter.ts',
    excerpt: 'header that none of its owning session',
    decidable: 'needs-values',
    checkerCode: 'TF062',
    note: 'D328’s runtime half. The checker reads a literal `Authorization`/`Cookie` on the nearest preceding `api` step in the same body; this catches the credential applied inside an `action` or by a `use`d file, by comparing the observed request against the sessions’ own contribution. Runs before any probe is sent, so a request carrying an unattributable identity is never re-issued',
  },
  {
    id: 'quantifier-vs-matches-schema',
    file: 'interpreter.ts',
    excerpt: '\\`any\\`/\\`all\\` cannot be combined with \\`matches schema\\`',
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'quantifier × matcher, both in the AST; folded into D140’s pass in M97b',
  },
  {
    id: 'quantifier-needs-json-body',
    file: 'interpreter.ts',
    excerpt: '\\`any\\`/\\`all\\` need a JSON response body',
    decidable: 'needs-values',
    note: 'whether the response was JSON',
  },
  {
    id: 'quantifier-found-no-array',
    file: 'interpreter.ts',
    excerpt: 'but never found one',
    decidable: 'needs-values',
    note: 'shape of the response — the paradigm shape rule, and exactly what D140 forbids the checker to guess',
  },
  {
    id: 'capture-vs-request-to-either',
    file: 'interpreter.ts',
    excerpt: '\\`capture\\` does not support a \\`request to "…"\\`/\\`of request to',
    decidable: 'static',
    checkerCode: 'TF053',
    note: 'M116/D150 — statement kind × subject kind. `TF053` tests `of != null` before subject kind, because `of request to "…"` rides on subjects whose own kind is `value`',
  },
  {
    id: 'capture-vs-page',
    file: 'interpreter.ts',
    excerpt: '\\`page\\` is not a capturable value',
    decidable: 'static',
    checkerCode: 'TF053',
    note: 'M116/D150 — one of the four `capture` × subject-kind throws `TF053` folds into a single rule',
  },
  {
    id: 'capture-vs-response',
    file: 'interpreter.ts',
    excerpt: '\\`response\\` is not a capturable value',
    decidable: 'static',
    checkerCode: 'TF053',
    note: 'M128b — the `page` row directly above, one subject over: `response` is a scan subject, and `SUBJECT_KINDS`/`UNCAPTURABLE_HINTS` decide it statically the same way',
  },
  {
    id: 'security-matcher-vs-response',
    file: 'interpreter.ts',
    excerpt: "isn't valid against \\`response\\`",
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'M128b — matcher × subject kind, decided by `checkMatcherSubjects` against `spec-data.ts`\'s `subjects: [\'response\']`. The throw is the runtime\'s backstop for a file run without a check pass, exactly like the `page`/a11y one it mirrors',
  },
  {
    id: 'body-path-not-json',
    file: 'interpreter.ts',
    excerpt: 'a \\`body.<path>\\` subject needs a JSON response',
    decidable: 'needs-values',
    note: 'whether the response was JSON',
  },
  {
    id: 'capture-vs-request',
    file: 'interpreter.ts',
    excerpt: '\\`request\\` is not a capturable/comparable value',
    decidable: 'static',
    checkerCode: 'TF053',
    note: 'M116/D150 — statement kind × subject kind',
  },
  {
    id: 'capture-vs-locator',
    file: 'interpreter.ts',
    excerpt: 'a UI locator is not a capturable value',
    decidable: 'static',
    checkerCode: 'TF053',
    note: 'M116/D150 — statement kind × subject kind',
  },
  {
    id: 'capture-vs-request-to',
    file: 'interpreter.ts',
    excerpt: '\\`capture\\` does not support a \\`request to "…"\\` subject',
    decidable: 'static',
    checkerCode: 'TF053',
    note: 'M116/D150 — the narrower partner of `capture-vs-request-to-either`, reached from the other resolve path; one rule covers both',
  },
  {
    id: 'env-has-no-api-base-url',
    file: 'interpreter.ts',
    excerpt: 'declares no default \\`api\\` base URL',
    decidable: 'static',
    checkerCode: 'TF051',
    note: 'M116/D148 — the `api` twin of `no-web-base-url`, and one code covers both. Reached from two call paths: an un-prefixed api request line, and `matches schema … from "<relative>"` via `contract.ts:45`',
  },
  {
    id: 'unknown-api-service',
    file: 'interpreter.ts',
    excerpt: 'unknown api service',
    decidable: 'static',
    checkerCode: 'TF026',
    note: 'services are declared in `tflw.config`',
  },
  {
    id: 'reserved-demo-scheme',
    file: 'interpreter.ts',
    excerpt: 'is not a real base URL',
    decidable: 'static',
    filedRow: 'M118-01',
    note: "M118 (`FU-04`) — `tflw run` substitutes the real loopback address for `tflw://demo` before anything executes, so this only fires on a typo under the reserved scheme (`tflw://demoo`). A base URL is a `tflw.config` string literal, so the checker could say it at check time and doesn't; filed rather than folded in, since it wants a diagnostic code and M118 declared none",
  },

  // -- matcher.ts ------------------------------------------------------------
  // The file D138's interpreter-only scan would have missed entirely, and the one that holds both
  // sides of D140's kind/shape line.
  {
    id: 'invalid-regex-operand',
    file: 'matcher.ts',
    excerpt: 'invalid regex in matcher',
    sites: 2,
    decidable: 'static-if-literal',
    checkerCode: 'TF054',
    filedRow: 'M97a-16',
    note: 'M124/D232 — a literal pattern compiles or does not, at check time, and both sides call `new RegExp` so the engine is the shared authority. The second site is reached by `expect request fails matching "…"` and **not** by `expect request to "/x" fails matching "…"`, which `TF042` refuses first — `M97a-16` reads as the latter, and taking its wording literally would have "confirmed" a site the checker never sees',
  },
  {
    id: 'matcher-request-only',
    file: 'matcher.ts',
    excerpt: 'is only valid on a \\`request\\` subject',
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'matcher × subject **kind** — the canonical D140 rule, and the reason the scan had to leave `interpreter.ts`',
  },
  {
    id: 'matcher-ui-only',
    file: 'matcher.ts',
    excerpt: 'is not supported on an API subject',
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'matcher × subject kind',
  },
  {
    id: 'matcher-not-valid-on-request',
    file: 'matcher.ts',
    excerpt: 'is not valid on a \\`request\\` subject',
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'matcher × subject kind',
  },
  {
    id: 'matches-subset-operand-shape',
    file: 'matcher.ts',
    excerpt: '\\`matches subset\\` expects an object literal operand',
    decidable: 'needs-values',
    note: 'M124/D234 — **`M97a-20` withdrawn, measured.** The row read "the *operand* is a literal in the AST; the subject half is not", and the first half is false: the grammar admits no non-object literal operand at all. `matches subset "s"`/`5`/`[1,2]`/`true` are each a `TF010` parse error, and `{ a: 1 }` is the only clean form — so this throw is reachable only through an interpolated `{…}`, which is the row\'s own explicitly out-of-scope half. The fourth withdrawal in this cluster, all four for the same mistake: reading an unreachable `throw` as an unchecked checker gap',
  },
  {
    id: 'matches-subset-subject-shape',
    file: 'matcher.ts',
    excerpt: '\\`matches subset\\` expects an object subject',
    decidable: 'needs-values',
    note: 'shape, not kind — D140',
  },
  {
    id: 'contains-subject-shape',
    file: 'matcher.ts',
    excerpt: '\\`contains\\` expects a string or array subject',
    decidable: 'needs-values',
    note: 'the load-bearing counter-example in D140: reading `contains`’ documented "strings, arrays" as a *static* claim about `body.msg` is how the fix for `A4-11` would reintroduce `A4-05`. Shape stays here',
  },
  {
    id: 'has-count-subject-shape',
    file: 'matcher.ts',
    excerpt: '\\`has count\\` expects an array',
    decidable: 'needs-values',
    note: 'shape, not kind — D140',
  },
  {
    id: 'matcher-expects-number',
    file: 'matcher.ts',
    excerpt: 'expects a number, got ${got}',
    decidable: 'needs-values',
    // `B3-04` widened what this rule fires on: it used to reject only what `Number()` mapped to
    // `NaN` (`{}`, `undefined`, a non-numeric string), and now rejects every non-number — `null`,
    // booleans, arrays and numeric-looking strings included. Still `needs-values`: whether a
    // response field holds a number is not decidable from the AST.
    note: 'shape of the compared value',
  },

  // -- pdf-text.ts -----------------------------------------------------------
  // Eight throws, one rule: the response body did not parse as a PDF. All share NOT_A_PDF_HINT.
  {
    id: 'body-pdf-text-unparseable',
    file: 'pdf-text.ts',
    excerpt: 'body pdf text:',
    sites: 8,
    decidable: 'needs-values',
    note: 'eight failure points in one parser, all reading the response body',
  },

  // -- uiMatcher.ts ----------------------------------------------------------
  {
    id: 'matcher-vs-ui-locator',
    file: 'uiMatcher.ts',
    excerpt: 'is not supported on a UI locator subject',
    decidable: 'static',
    checkerCode: 'TF042',
    note: 'matcher × subject kind — the UI twin of `matcher-request-only`',
  },
];
