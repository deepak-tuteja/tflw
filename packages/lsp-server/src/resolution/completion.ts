// Autocomplete candidates (PLAN_M13_LSP.md Phase 2, design decision 3): given the grammar-shape
// `CompletionContext` `@tflw/lang`'s `getCompletionContext` already computed (Phase 1), produce
// the candidate list for it. `step`/`subject` are fixed, tiny keyword sets; `matcher`/`unique`/
// `random` are backed by `spec-data.ts` (the same manifest hover.ts and the docs site use);
// `session` is symbol-name completion — its candidates (the project's declared session names)
// come from the caller (Phase 3's I/O layer resolves `tflw.config`; `packages/lang` has no
// notion of "the project" to fetch them itself).

import { GENERATORS, MATCHERS, type CompletionContext } from '@tflw/lang';

export interface CompletionCandidate {
  readonly label: string;
  readonly detail?: string;
}

export interface CompletionSources {
  readonly knownSessions?: readonly string[];
}

// Independent copies of parser.ts's `STATEMENT_KEYWORDS`/`SUBJECT_KEYWORDS` (kept local rather
// than exported, same house-style tradeoff already accepted for tflw.tmLanguage.json/
// semanticTokens.ts's own wordlists — M3e/M4a) — must be kept in sync with the browser-arc
// (M3a-M3e) constructs those lists gained, plus `log` (M27/M28, PLAN_LOG_LSP.md).
//
// M29-M32 (load testing, M33 catch-up): `think` is a real `Step` AST production reached through
// `parseStep()`'s own switch like every other entry here — the checker (not the parser) is what
// restricts it to `scenario` bodies (TF033), so it naturally participates in this same flat,
// container-blind list, exactly like a browser step still being offered inside a `before`/`after`
// hook even though it's really only meaningful there some of the time. `ramp`/`threshold`/
// `cleanup` are structurally different — they're dispatched by `parseScenarioDecl`'s own loop
// *before* `parseStep()` is ever reached, not `Step` productions at all — but a partial word typed
// at that exact cursor position (not yet matching any of the three exactly) falls through to
// `parseStep()`'s completion gate the same way, so the same `kind: 'step'` signal is what a user
// typing inside a `scenario` body actually sees; bundled in here rather than left offering an
// incomplete list at that position, accepting the same over-broad-but-harmless tradeoff already
// baked into every other entry in this list.
const STEP_KEYWORDS = [
  'api', 'expect', 'check', 'let', 'capture', 'log', 'wait', 'give',
  'open', 'click', 'double', 'right', 'fill', 'select', 'uncheck', 'press', 'hover', 'scroll',
  'within', 'accept', 'dismiss', 'switch', 'close', 'download', 'drag', 'drop', 'screenshot', 'stub',
  'think', 'ramp', 'threshold', 'cleanup',
] as const;
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

/** Candidates whose `label` starts with `ctx.prefix` — plain prefix filtering, no fuzzy matching
 * (the editor's own completion widget re-filters as the user keeps typing; this just avoids
 * shipping obviously-irrelevant entries on the first response). */
export function getCompletions(ctx: CompletionContext, sources: CompletionSources = {}): CompletionCandidate[] {
  const byPrefix = (label: string): boolean => label.startsWith(ctx.prefix);
  switch (ctx.kind) {
    case 'step':
      return STEP_KEYWORDS.filter(byPrefix).map((label) => ({ label }));
    case 'subject':
      return SUBJECT_KEYWORDS.filter(byPrefix).map((label) => ({ label }));
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
  }
}
