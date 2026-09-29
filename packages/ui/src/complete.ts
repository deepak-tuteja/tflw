// `M250` `A` (`D1361`) — what the page's editor offers at a cursor, apart from the editor.
//
// The editor draws it (`Editor.tsx`, through `@codemirror/autocomplete`); this decides it, and it
// decides it by asking the language server's own `getCompletions` (`@tflw/lsp-server/pure`) at the
// position `getCompletionContext` names. Kept out of `Editor.tsx` so a node test can run the LSP's
// completion corpus against it without a DOM.
import { collectSymbols, getCompletionContext, getConfigCompletionContext, parseSource, type Dialect } from '@tflw/lang';
import { getCompletions, variablesInScopeAt, type CompletionSources } from '@tflw/lsp-server/pure';

/** One entry, in `@codemirror/autocomplete`'s `Completion` shape: matched on `label`, shown as
 *  `displayLabel` when there is one, inserted as `apply` when there is one. */
export interface CompletionOption {
  readonly label: string;
  readonly detail?: string;
  readonly displayLabel?: string;
  readonly apply?: string;
}

/**
 * The list at the cursor: the language's answer to *what goes here*, filled with the names this
 * buffer and the caller know. `null` — no list — where the grammar has no instrumented position, and
 * where nothing is typed yet unless the list was asked for (Ctrl+Space), so a space never opens one.
 */
export function completeAt(text: string, pos: number, dialect: Dialect, sessions: readonly string[], explicit: boolean): { from: number; options: CompletionOption[] } | null {
  const ctx = dialect === 'test' ? getCompletionContext(text, pos) : getConfigCompletionContext(text, pos);
  if (ctx === null || (ctx.prefix === '' && !explicit)) return null;
  const sources: { -readonly [K in keyof CompletionSources]: CompletionSources[K] } = { knownSessions: sessions };
  if (dialect === 'test' && (ctx.kind === 'subject' || ctx.kind === 'locator')) {
    const { program } = parseSource(text);
    // The file's own elements, as Compose's locator fields offer them; an imported name is typed,
    // and `TF089` answers whether it resolves.
    sources.knownElements = (program.elements ?? []).map((e) => e.name);
    if (ctx.kind === 'subject') sources.knownVariables = variablesInScopeAt(program, collectSymbols(program, text), pos);
  }
  let from = pos - ctx.prefix.length;
  const options = getCompletions(ctx, sources).map((c): CompletionOption => {
    const option: CompletionOption = { label: c.filterText ?? c.label, ...(c.detail === undefined ? {} : { detail: c.detail }) };
    // A value is matched on its name and inserted braced: `or` finds `{orderId}`.
    return c.filterText === undefined ? option : { ...option, displayLabel: c.label, apply: c.label };
  });
  // Typed `{or`: the brace is already in the text, so the insertion starts at it rather than after.
  if (ctx.kind === 'subject' && text[from - 1] === '{' && options.some((o) => typeof o.apply === 'string' && o.apply.startsWith('{'))) from -= 1;
  return options.length === 0 ? null : { from, options };
}

