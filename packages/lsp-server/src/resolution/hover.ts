// Hover (PLAN_M13_LSP.md Phase 2, decision 17.7): a pure function producing markdown for whatever
// AST node / symbol sits at an offset. Matcher and generator hover text is sourced from
// `@tflw/lang`'s `spec-data.ts` (`MATCHERS`/`GENERATORS`, the same manifest the docs site and
// `gen-spec-tables.mjs` already render from — single source of truth, decision 17.7). Hovering an
// active diagnostic squiggle additionally surfaces `DIAGNOSTICS`' canonical meaning + example
// alongside the diagnostic's own live message/hint (decision 20.6, docs-site polish cluster 9) —
// takes priority over matcher/generator/symbol hover, since "why is this red" is the most
// relevant thing to show when there's an error right here.

import { DIAGNOSTICS, GENERATORS, MATCHERS, STEP_KEYWORDS, getCompletionContext, type Diagnostic, type Matcher, type MatcherName, type Node, type Program, type SymbolKind, type SymbolRef, type SymbolTable, type TransformExpr } from '@tflw/lang';
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
  matchesFile: 'matches-file',
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
  wasMade: 'was-made',
  hasNoA11yViolations: 'has-no-a11y-violations',
  hasNoSecurityViolations: 'has-no-security-violations',
  matchesSnapshot: 'matches-snapshot',
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

/** `TransformExpr.kind` → the matching `spec-data.ts` `GeneratorEntry.id` (decision 22/M18 — one
 * AST node type covers all three transform kinds, unlike the generator nodes above which are each
 * one-node-per-id, so this needs its own lookup keyed on `kind` rather than `node.type`). */
const TRANSFORM_SPEC_ID: Record<TransformExpr['kind'], string> = {
  base64: 'transform-base64',
  hex: 'transform-hex',
  url: 'transform-url',
};

const SYMBOL_KIND_LABEL: Record<SymbolKind, string> = {
  variable: 'variable',
  param: 'action parameter',
  action: 'action',
  session: 'session',
  // Reached since `M125e`/D279a — but from `refLabel` below, never from a ref that *carries* this
  // kind. `collectSymbols` has never produced `'importedAction'` and (D279a) deliberately still
  // doesn't; the sibling branches in `semanticTokens.ts` and `rename.ts` remain dead as they have
  // been since `M13`. Kept in the map because the label it holds is the one `refLabel` prints.
  importedAction: 'imported action',
};

/**
 * The label a symbol *ref* hovers as (`FU-24`, D279a).
 *
 * An `action` ref with no `defSpan`, in a file that brings names in from elsewhere, is a call into
 * an import or a `use`d JS helper — before this, every such call hovered as a plain `action` and
 * the reader was told nothing about where to look for it.
 *
 * Derived here rather than written into `SymbolRef.kind`, which is where it was tried first.
 * `SymbolKind` is an identity key — `definition.ts` reads `'action'` to decide a call needs
 * cross-file resolution, `findCrossFileRenameEdits` matches `(kind, name)` across the workspace —
 * so a second kind for the same thing made both of them miss imported calls entirely, silently and
 * with no type error. A label is a property of the hover, so it is computed in the hover.
 *
 * "Not defined here, in a file that imports names from elsewhere" is the most that can honestly be
 * said without I/O: `use`/`import` are whole-module and name no symbols, so *which* file a name
 * came from is knowable only to the layer that reads those files. A misspelt call in an importing
 * file therefore lands here too — it is already a diagnostic, and the diagnostic branch above
 * answers first.
 */
function refLabel(ref: SymbolRef, root: Node): string {
  if (ref.kind === 'action' && !ref.defSpan && bringsInNames(root)) return SYMBOL_KIND_LABEL.importedAction;
  return SYMBOL_KIND_LABEL[ref.kind];
}

/** Whether this file can have received a name from elsewhere. Guarded on the type tag rather than
 * assuming a `Program`: `getHover` also serves `tflw.config` buffers (decision A), which have
 * neither list — and "no, nothing came from elsewhere" is the right answer for a config file, not a
 * crash. */
function bringsInNames(root: Node): boolean {
  if (root.type !== 'Program') return false;
  const program = root as Program;
  return program.imports.length > 0 || program.uses.length > 0;
}

/**
 * The step keyword a line begins with, if `offset` is inside it (`FU-24`, D280).
 *
 * Resolved from text rather than from the AST, and that is the whole design: a step keyword is
 * *defined* as the first word of a line, whereas it is not a node — `click`, `double click` and
 * `right click` are one `ClickStmt` discriminated by a field, and `CallStmt`/`HeaderStmt` are led by
 * no keyword at all. A node-type map would have to restate a relation the source text states
 * directly.
 *
 * The risk a textual rule carries is over-matching, and the guard against it is **the grammar's own
 * answer** rather than a list of node types to exclude. `getCompletionContext(text, wordStart)`
 * reports `step` exactly where a statement may begin, so `log:` inside a wrapped body literal and
 * `api` inside `log "api is down"` are both refused by the parser rather than by a denylist someone
 * has to remember to extend. Two earlier attempts here named node types that do not exist
 * (`JsonObject`, `TemplateLit`) and named ones that are not what a body produces (`ObjectLit`, where
 * the real path is `InlineBody`/`Field`) — a wrong name is not a loose guard, it is no guard, and
 * nothing about it looks wrong at the call site.
 *
 * This is also why the hovered word and the completion list can never disagree about where a step
 * may start: they are the same function. It leans on D278's blank-line branch — truncating at
 * `wordStart` leaves a whitespace-only tail, which is precisely the case that used to return null.
 */
function stepKeywordAt(text: string, offset: number): HoverResult | null {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))![0].length;
  const wordStart = lineStart + indent;
  const word = /^[a-z]+/.exec(text.slice(wordStart))?.[0];
  if (!word) return null;
  // Strictly inside the first word — `offset === wordStart + word.length` is the character after
  // it, where an editor is already showing whatever comes next.
  if (offset < wordStart || offset >= wordStart + word.length) return null;
  const entry = STEP_KEYWORDS.find((k) => k.id === word);
  if (!entry) return null;
  if (getCompletionContext(text, wordStart)?.kind !== 'step') return null;
  const contents = `${entry.syntax}\n\n${entry.summary}\n\nExample: ${entry.example}`;
  // `line`/`column`, not just `offset`: `toLspRange` reads the 1-based pair and ignores `offset`
  // entirely (`M106-01` is about that same conversion), so a span carrying only an offset would
  // highlight the first character of the file.
  const line = countLines(text, lineStart);
  const span = {
    start: { line, column: indent + 1, offset: wordStart },
    end: { line, column: indent + 1 + word.length, offset: wordStart + word.length },
  };
  return { contents, span };
}

/** 1-based line number of the offset, counted rather than tracked — this is the one place in hover
 * that starts from raw text instead of from a node that already knows where it is. */
function countLines(text: string, upTo: number): number {
  let n = 1;
  for (let i = 0; i < upTo; i++) if (text[i] === '\n') n++;
  return n;
}

/**
 * Hover text for whatever's at `offset`: a matcher keyword or generator expression (from
 * spec-data.ts) takes priority over a plain symbol ref/def, since the former carries richer,
 * pre-authored documentation. Falls through to a symbol ref, then a symbol def (clicking a
 * definition still shows something), then `null`.
 *
 * `root` accepts either dialect's AST root (`Program` or `ConfigFile`, both `Node`s) — Phase 3
 * needs hover to also work over `tflw.config` buffers (decision A). It is threaded through to
 * `findNodeAtOffset`'s generic `Node` walk, and (since `M125e`/D279a) read for `imports`/`uses` by
 * `bringsInNames`, which tests the type tag first for exactly this reason.
 *
 * `diagnostics` (default none) is the document's current diagnostic list — if `offset` falls
 * inside one, its live `message`/`hint` plus `DIAGNOSTICS`' canonical meaning/example win over
 * everything else below (decision 20.6).
 */
export function getHover(root: Node, table: SymbolTable, offset: number, diagnostics: readonly Diagnostic[] = [], text = ''): HoverResult | null {
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
    if (node.type === 'TransformExpr') {
      const entry = GENERATORS.find((g) => g.id === TRANSFORM_SPEC_ID[(node as TransformExpr).kind]);
      if (entry) return { contents: `${entry.syntax}\n\n${entry.notes}\n\nExample: ${entry.example}`, span: node.span };
    }
  }

  const ref = table.refs.find((r) => spanContains(r.span, offset));
  if (ref) return { contents: `**${ref.name}**: ${refLabel(ref, root)}`, span: ref.span };
  const def = table.defs.find((d) => spanContains(d.span, offset));
  if (def) return { contents: `**${def.name}**: ${SYMBOL_KIND_LABEL[def.kind]}`, span: def.span };
  // Last, not first: a symbol may legitimately be named after a keyword, and an active diagnostic
  // on this line is still the more relevant answer.
  return text ? stepKeywordAt(text, offset) : null;
}
