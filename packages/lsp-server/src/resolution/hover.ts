// Hover (PLAN_M13_LSP.md Phase 2, decision 17.7): a pure function producing markdown for whatever
// AST node / symbol sits at an offset. Matcher and generator hover text is sourced from
// `@tflw/lang`'s `spec-data.ts` (`MATCHERS`/`GENERATORS`, the same manifest the docs site and
// `gen-spec-tables.mjs` already render from — single source of truth, decision 17.7). Hovering an
// active diagnostic squiggle additionally surfaces `DIAGNOSTICS`' canonical meaning + example
// alongside the diagnostic's own live message/hint (decision 20.6, docs-site polish cluster 9) —
// takes priority over matcher/generator/symbol hover, since "why is this red" is the most
// relevant thing to show when there's an error right here.

import { DIAGNOSTICS, GENERATORS, MATCHERS, type Diagnostic, type Matcher, type MatcherName, type Node, type SymbolKind, type SymbolTable } from '@tflw/lang';
import { findNodeAtOffset, spanContains } from './findNodeAtOffset.js';
import type { Span } from '@tflw/lang';

export interface HoverResult {
  readonly contents: string;
  readonly span: Span;
}

/** `MatcherName` (the AST's closed union) → the matching `spec-data.ts` `MatcherEntry.id`. Several
 * AST names collapse onto one spec-data row (`greaterThan`/`lessThan` are one table row; the five
 * state words are another), mirroring SPEC §6.2's own table shape. */
const MATCHER_SPEC_ID: Record<MatcherName, string> = {
  equals: 'equals',
  contains: 'contains',
  matches: 'matches-regex',
  matchesSubset: 'matches-subset',
  matchesSchema: 'matches-schema',
  greaterThan: 'greater-less-than',
  lessThan: 'greater-less-than',
  hasCount: 'has-count',
  hasValue: 'has-value',
  visible: 'state-word',
  hidden: 'state-word',
  enabled: 'state-word',
  disabled: 'state-word',
  checked: 'state-word',
  connects: 'connects',
  fails: 'fails',
};

/** Generator AST node `type` → the matching `spec-data.ts` `GeneratorEntry.id`. Only generator
 * node types appear here (leaf/value nodes with no generator meaning are simply absent). */
const GENERATOR_SPEC_ID: Partial<Record<string, string>> = {
  UniquePrefixExpr: 'unique-prefix',
  UniqueEmailExpr: 'unique-email',
  UniqueNumberExpr: 'unique-number',
  UniqueLikeExpr: 'unique-like',
  UniqueUuidExpr: 'unique-uuid',
  RandomNumberExpr: 'random-number',
  RandomDecimalExpr: 'random-number',
  RandomDateInPastExpr: 'random-date',
  RandomDateInFutureExpr: 'random-date',
  RandomDateBetweenExpr: 'random-date',
  RandomOfExpr: 'random-of',
  RandomStringExpr: 'random-string',
  RandomLikeExpr: 'random-like',
  RandomUuidExpr: 'random-uuid',
  RandomPasswordExpr: 'random-password',
};

const SYMBOL_KIND_LABEL: Record<SymbolKind, string> = {
  variable: 'variable',
  param: 'action parameter',
  action: 'action',
  session: 'session',
  importedAction: 'imported action',
};

/**
 * Hover text for whatever's at `offset`: a matcher keyword or generator expression (from
 * spec-data.ts) takes priority over a plain symbol ref/def, since the former carries richer,
 * pre-authored documentation. Falls through to a symbol ref, then a symbol def (clicking a
 * definition still shows something), then `null`.
 *
 * `root` accepts either dialect's AST root (`Program` or `ConfigFile`, both `Node`s) — Phase 3
 * needs hover to also work over `tflw.config` buffers (decision A), and this function never reads
 * a `Program`-specific field, only threads it through to `findNodeAtOffset`'s generic `Node` walk.
 *
 * `diagnostics` (default none) is the document's current diagnostic list — if `offset` falls
 * inside one, its live `message`/`hint` plus `DIAGNOSTICS`' canonical meaning/example win over
 * everything else below (decision 20.6).
 */
export function getHover(root: Node, table: SymbolTable, offset: number, diagnostics: readonly Diagnostic[] = []): HoverResult | null {
  const diag = diagnostics.find((d) => spanContains(d.span, offset));
  if (diag) {
    const entry = DIAGNOSTICS.find((e) => e.code === diag.code);
    const parts = [`**${diag.severity}[${diag.code}]**: ${diag.message}`];
    if (diag.hint) parts.push(`= help: ${diag.hint}`);
    if (entry) parts.push(`---\n\n${entry.meaning}\n\nExample: ${entry.example}`);
    return { contents: parts.join('\n\n'), span: diag.span };
  }

  const path = findNodeAtOffset(root, offset);
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i]!;
    if (node.type === 'Matcher') {
      const specId = MATCHER_SPEC_ID[(node as Matcher).name];
      const entry = MATCHERS.find((m) => m.id === specId);
      if (entry) return { contents: `${entry.syntax}\n\nApplies to: ${entry.appliesTo}\n\nExample: ${entry.example}`, span: node.span };
    }
    const genId = GENERATOR_SPEC_ID[node.type];
    if (genId) {
      const entry = GENERATORS.find((g) => g.id === genId);
      if (entry) return { contents: `${entry.syntax}\n\n${entry.notes}\n\nExample: ${entry.example}`, span: node.span };
    }
  }

  const ref = table.refs.find((r) => spanContains(r.span, offset));
  if (ref) return { contents: `**${ref.name}**: ${SYMBOL_KIND_LABEL[ref.kind]}`, span: ref.span };
  const def = table.defs.find((d) => spanContains(d.span, offset));
  if (def) return { contents: `**${def.name}**: ${SYMBOL_KIND_LABEL[def.kind]}`, span: def.span };
  return null;
}
