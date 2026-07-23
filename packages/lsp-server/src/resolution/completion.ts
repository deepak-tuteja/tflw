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

const STEP_KEYWORDS = ['api', 'expect', 'check', 'let', 'capture', 'wait', 'give'] as const;
const SUBJECT_KEYWORDS = ['status', 'duration', 'header', 'body', 'request'] as const;

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
