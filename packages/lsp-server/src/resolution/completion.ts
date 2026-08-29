// Autocomplete candidates (PLAN_M13_LSP.md Phase 2, design decision 3): given the grammar-shape
// `CompletionContext` `@tflw/lang`'s `getCompletionContext` already computed (Phase 1), produce
// the candidate list for it. `step`/`subject` are fixed, tiny keyword sets; `matcher`/`unique`/
// `random` are backed by `spec-data.ts` (the same manifest hover.ts and the docs site use);
// `session` is symbol-name completion — its candidates (the project's declared session names)
// come from the caller (Phase 3's I/O layer resolves `tflw.config`; `packages/lang` has no
// notion of "the project" to fetch them itself).

import {
  CONFIG_KEYWORDS,
  GENERATORS,
  MATCHERS,
  STEP_KEYWORDS,
  configKeyAllowedIn,
  type CompletionContext,
  type ConfigBlockKind,
  type ConfigKeywordSlot,
  type Program,
  type Span,
  type SymbolTable,
} from '@tflw/lang';

export interface CompletionCandidate {
  readonly label: string;
  readonly detail?: string;
  /** What the client matches the typed prefix against, when that differs from `label`. Needed by
   * the value subject (M96): the label is `{orderId}` because that is what has to end up in the
   * buffer, but the user types `or` — with no `filterText` the client would drop the entry the
   * moment they typed the first character. */
  readonly filterText?: string;
}

export interface CompletionSources {
  readonly knownSessions?: readonly string[];
  /** Names bound by `let`/`capture`/an action parameter and visible at the cursor (M96, `FU-11`).
   * Same shape as `knownSessions`: `packages/lang` has no notion of "what is in scope *here*", so
   * the caller (Phase 3's I/O layer, which holds the symbol table) resolves it. */
  readonly knownVariables?: readonly string[];
}

// `M125e`/`FU-24`/D251: the step list used to live here as thirty-seven bare strings — an
// independent copy of parser.ts's `STATEMENT_KEYWORDS` plus the workload directives, kept local on
// the same house-style tradeoff as tflw.tmLanguage.json/semanticTokens.ts's own wordlists
// (M3e/M4a). Bare strings are why completion could offer `api` and say nothing about it. They now
// come from `spec-data.ts`'s `STEP_KEYWORDS`, which carries the `detail` text with them and is held
// to the parser's own lists by `stepKeywords.test.ts` (D277) — so the copy that used to need
// manual syncing against every browser-arc and load-testing addition cannot silently fall behind
// one any more. Retired spellings (`think`, `uncheck`, `cleanup`) stay out by construction: the
// manifest never held the first two, and `M157c` deleted the third's row in the same commit that
// retired the keyword — which is `D724`'s rule (*no construct without a row*) read in the direction
// it is usually not: the row goes when the construct does, and the completion list follows for free
// rather than needing its own edit.
//
// Still deliberately flat and container-blind. `ramp`/`hold`/`step`/`spike`/`run`/`threshold`
// are dispatched by `parseTestBody`'s own loop *before* `parseStep()` is ever reached and
// are not `Step` productions at all, but a partial word typed at that exact cursor position falls
// through to `parseStep()`'s completion gate anyway, so `kind: 'step'` is what a user typing inside
// any `test` body actually gets. Offering them here is the same over-broad-but-harmless tradeoff
// that already offers a browser step inside a `before` hook.
const SUBJECT_KEYWORDS = ['status', 'duration', 'header', 'body', 'request', 'button', 'field', 'text', 'list', 'css', 'xpath', 'page'] as const;

/** Plain typeable matcher keyword → the `spec-data.ts` `MatcherEntry.id` supplying its detail
 * text. Not 1:1 with `MatcherEntry` rows (`is greater than`/`is less than` share one row; the five
 * state words share another) — this list is what's actually typeable, spec-data is what documents
 * it (decision 3: candidates aren't sourced from the parser's own local keyword lists, but the
 * *label* text still has to match what the grammar accepts, which spec-data's markdown-formatted
 * `syntax` field isn't meant to be parsed back out of). */
const MATCHER_CANDIDATES: readonly { readonly label: string; readonly specId: string }[] = [
  { label: 'equals', specId: 'equals' },
  { label: 'contains', specId: 'contains' },
  { label: 'matches', specId: 'matches-regex' },
  { label: 'matches subset', specId: 'matches-subset' },
  { label: 'matches schema', specId: 'matches-schema' },
  { label: 'matches file', specId: 'matches-file' },
  { label: 'has count', specId: 'has-count' },
  { label: 'has value', specId: 'has-value' },
  { label: 'is greater than', specId: 'greater-less-than' },
  { label: 'is less than', specId: 'greater-less-than' },
  { label: 'is visible', specId: 'state-word' },
  { label: 'is hidden', specId: 'state-word' },
  { label: 'is enabled', specId: 'state-word' },
  { label: 'is disabled', specId: 'state-word' },
  { label: 'is checked', specId: 'state-word' },
  { label: 'connects', specId: 'connects' },
  { label: 'fails', specId: 'fails' },
  { label: 'was made', specId: 'was-made' },
  { label: 'has no a11y violations', specId: 'has-no-a11y-violations' },
  { label: 'has no minor a11y violations', specId: 'has-no-a11y-violations' },
  { label: 'has no moderate a11y violations', specId: 'has-no-a11y-violations' },
  { label: 'has no serious a11y violations', specId: 'has-no-a11y-violations' },
  { label: 'has no critical a11y violations', specId: 'has-no-a11y-violations' },
  // M133 (D24b catch-up) — the pentest arc's two scans, spelled out at every severity exactly as
  // a11y is above. All three share `FindingSeverity` and the same floor semantics (`ast.ts`'s
  // `severityFloor`), so the shape is copied rather than invented; what differs is only which rules
  // the floor selects, and that lives in each scanner. Enumerating the severities is what makes the
  // floor *discoverable* — a bare `has no security violations` teaches nobody that
  // `has no serious security violations` exists, and the arc's own guide is not what a user reads
  // while typing.
  { label: 'has no security violations', specId: 'has-no-security-violations' },
  { label: 'has no minor security violations', specId: 'has-no-security-violations' },
  { label: 'has no moderate security violations', specId: 'has-no-security-violations' },
  { label: 'has no serious security violations', specId: 'has-no-security-violations' },
  { label: 'has no critical security violations', specId: 'has-no-security-violations' },
  { label: 'has no authorization violations', specId: 'has-no-authorization-violations' },
  { label: 'has no minor authorization violations', specId: 'has-no-authorization-violations' },
  { label: 'has no moderate authorization violations', specId: 'has-no-authorization-violations' },
  { label: 'has no serious authorization violations', specId: 'has-no-authorization-violations' },
  { label: 'has no critical authorization violations', specId: 'has-no-authorization-violations' },
  // M134a — the third scan, enumerated to the same depth for the same reason. `M133` found this
  // list holding five a11y candidates and **zero** for either pentest scan, four milestones after
  // the first one shipped; catching the third one up in its own milestone is the correction.
  { label: 'has no input handling violations', specId: 'has-no-input-handling-violations' },
  { label: 'has no minor input handling violations', specId: 'has-no-input-handling-violations' },
  { label: 'has no moderate input handling violations', specId: 'has-no-input-handling-violations' },
  { label: 'has no serious input handling violations', specId: 'has-no-input-handling-violations' },
  { label: 'has no critical input handling violations', specId: 'has-no-input-handling-violations' },
  { label: 'matches snapshot', specId: 'matches-snapshot' },
  { label: 'not', specId: '' },
];

const UNIQUE_CANDIDATES: readonly { readonly label: string; readonly specId: string }[] = [
  { label: 'email', specId: 'unique-email' },
  { label: 'number', specId: 'unique-number' },
  { label: 'like', specId: 'unique-like' },
  { label: 'uuid', specId: 'unique-uuid' },
];

const RANDOM_CANDIDATES: readonly { readonly label: string; readonly specId: string }[] = [
  { label: 'number', specId: 'random-number' },
  { label: 'decimal', specId: 'random-number' },
  { label: 'date in past', specId: 'random-date' },
  { label: 'date in future', specId: 'random-date' },
  { label: 'date between', specId: 'random-date' },
  { label: 'of', specId: 'random-of' },
  { label: 'string', specId: 'random-string' },
  { label: 'like', specId: 'random-like' },
  { label: 'uuid', specId: 'random-uuid' },
  { label: 'password', specId: 'random-password' },
];

/** After `base64`/`hex`/`url` (decision 22/M18) — the completion context doesn't carry which of
 * the three transform keywords was typed (`CompletionKind` is just `'transform'`), but every
 * `transform-*` spec-data row shares the same kind-agnostic `notes` text, so any one of the three
 * ids is a valid detail source for both candidates here. */
const TRANSFORM_CANDIDATES: readonly { readonly label: string; readonly specId: string }[] = [
  { label: 'encode', specId: 'transform-base64' },
  { label: 'decode', specId: 'transform-base64' },
];

function matcherDetail(specId: string): string | undefined {
  const entry = MATCHERS.find((m) => m.id === specId);
  return entry ? `${entry.appliesTo} — ${entry.example}` : undefined;
}

function generatorDetail(specId: string): string | undefined {
  const entry = GENERATORS.find((g) => g.id === specId);
  return entry ? `${entry.notes} — ${entry.example}` : undefined;
}

/**
 * Names a `{variable}` subject could legally refer to at `offset` (M96/D134) — `let`/`capture`
 * bindings and action parameters, narrowed to the one `test`/`action`/hook body the cursor sits in.
 *
 * Scoped by **span containment**, not by re-deriving `symbols.ts`'s `scopeId` strings: those encode
 * a decl's start offset in their text (`test:1234`), and reconstructing that format here would make
 * this function break silently the day that format changes. Two deliberate imprecisions, both
 * chosen to fail toward offering *less*:
 *
 *  - Only bindings **above** the cursor are offered. A `let` further down the same test is not yet
 *    in scope at this line, and the checker would say so (`TF030`).
 *  - A `before each` hook binds into every test body (`symbols.ts` walks it under the test's own
 *    scope), so its names are added when the cursor is in a test — without the above-cursor rule,
 *    since such a hook runs first whatever order it appears in the file. `before file` is *not*
 *    included: its scope does not reach a test body at run time.
 */
export function variablesInScopeAt(program: Program, symbols: SymbolTable, offset: number): readonly string[] {
  const contains = (span: Span, at: number): boolean => span.start.offset <= at && at <= span.end.offset;
  const enclosingTest = program.tests.find((t) => contains(t.span, offset));
  const enclosing: Span | undefined =
    enclosingTest?.span ??
    program.actions.find((a) => contains(a.span, offset))?.span ??
    program.hooks.find((h) => contains(h.span, offset))?.span;
  if (!enclosing) return [];

  const beforeEach = enclosingTest ? program.hooks.filter((h) => h.scope === 'each' && h.when === 'before') : [];
  const names = new Set<string>();
  for (const def of symbols.defs) {
    if (def.kind !== 'variable' && def.kind !== 'param') continue;
    if (contains(enclosing, def.span.start.offset) && def.span.start.offset < offset) names.add(def.name);
    else if (beforeEach.some((h) => contains(h.span, def.span.start.offset))) names.add(def.name);
  }
  return [...names].sort();
}

/** Candidates whose `label` starts with `ctx.prefix` — plain prefix filtering, no fuzzy matching
 * (the editor's own completion widget re-filters as the user keeps typing; this just avoids
 * shipping obviously-irrelevant entries on the first response). */
export function getCompletions(ctx: CompletionContext, sources: CompletionSources = {}): CompletionCandidate[] {
  const byPrefix = (label: string): boolean => label.startsWith(ctx.prefix);
  switch (ctx.kind) {
    // `FU-24`: `detail` is what makes the list teach rather than merely list. The summary alone,
    // not the syntax — a completion widget renders `detail` on one line next to the label, and the
    // syntax line is what hover is for.
    case 'step':
      return STEP_KEYWORDS.filter((k) => byPrefix(k.id)).map((k) => ({ label: k.id, detail: k.summary }));
    // M96/D134 — `FU-11`'s real failure mode was never that the grammar rejected `expect
    // {orderId} …`; it was that nobody discovered the form. The subject list is a wall a user hits
    // once and routes around permanently, and what they learn instead is the `actions.md`
    // workaround. So this is load-bearing, not polish.
    //
    // Keywords rank ahead of variables without any `sortText` bookkeeping: a variable's label is
    // `{orderId}`, and `{` sorts after every letter, so the default lexicographic order a client
    // applies already puts `status` the response subject above someone's `let status = …`.
    case 'subject':
      return [
        ...SUBJECT_KEYWORDS.filter(byPrefix).map((label) => ({ label })),
        ...(sources.knownVariables ?? [])
          .filter(byPrefix)
          .map((name) => ({ label: `{${name}}`, filterText: name, detail: 'value bound with `let`/`capture`' })),
      ];
    case 'matcher':
      return MATCHER_CANDIDATES.filter((c) => byPrefix(c.label)).map((c) => ({ label: c.label, detail: matcherDetail(c.specId) }));
    case 'unique':
      return UNIQUE_CANDIDATES.filter((c) => byPrefix(c.label)).map((c) => ({ label: c.label, detail: generatorDetail(c.specId) }));
    case 'random':
      return RANDOM_CANDIDATES.filter((c) => byPrefix(c.label)).map((c) => ({ label: c.label, detail: generatorDetail(c.specId) }));
    case 'transform':
      return TRANSFORM_CANDIDATES.filter((c) => byPrefix(c.label)).map((c) => ({ label: c.label, detail: generatorDetail(c.specId) }));
    case 'session':
      return (sources.knownSessions ?? []).filter(byPrefix).map((label) => ({ label }));

    // -- the config dialect (`M137a`, D444) ---------------------------------------------------
    //
    // Every one of these is a fixed vocabulary read straight off `CONFIG_KEYWORDS`, which
    // `configCompletionDetail.test.ts` holds to the parser's own arrays. Nothing here restates a
    // wordlist, which is the point: this is the milestone repairing `B5-09`'s third instance.
    case 'config-directive':
      return configSlot('directive').filter((c) => byPrefix(c.label));
    case 'defaults-key':
      return configKeys('defaults').filter((c) => byPrefix(c.label));
    case 'env-key':
      return configKeys('env').filter((c) => byPrefix(c.label));
    // Whole phrases, because this is the start of the sub-clause line and `probe` is the only word
    // that can begin one — the same reason `matcher` offers `has no critical security violations`
    // rather than `has`. `SUGGESTION_VOCABULARIES.scanKind` states the rule for the hint side.
    case 'probe':
      return configSlot('probe').map((c) => ({ ...c, label: `probe ${c.label}` })).filter((c) => byPrefix(c.label));
    case 'probe-class':
      return configSlot('probe').filter((c) => byPrefix(c.label));
  }
}

function configSlot(slot: ConfigKeywordSlot): CompletionCandidate[] {
  return CONFIG_KEYWORDS.filter((e) => e.slot === slot).map((e) => ({ label: e.id, detail: e.summary }));
}

/** The keys legal in this block, and only those. `A2-07b` is why the filter is here rather than
 * left to the checker: offering a key and then rejecting it is a tool that tells you what to write
 * and refuses it, and that row was filed against the did-you-mean hint — a much quieter surface
 * than a candidate list. */
function configKeys(block: ConfigBlockKind): CompletionCandidate[] {
  return configSlot('key').filter((c) => configKeyAllowedIn(c.label, block));
}
