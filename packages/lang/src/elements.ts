// `M247` `D` (`D1356`) — `element` references, found and inlined.
//
// An element reference is a `Locator` of kind `element` whose value is the declared name
// (`parser.ts`, `elementRef`). It can sit in any locator position — a step's target, a subject, a
// `within` scope, a snapshot `mask` — so rather than teach every one of those positions a second
// shape, both functions here walk the tree structurally and act on the one node shape wherever it
// is. The AST is plain data (no cycles, no class instances), which is what makes a structural walk
// safe; a position added later is covered without being listed.
//
// Resolution is the `action` rule (`buildRegistry`): the file's own declarations, then each
// `import`ed file's. A name declared twice across that namespace is `TF035` and is refused before a
// run, so the lookup never has to choose.

import type { Locator, Program } from './ast.js';

/** Every `element` reference under `node`, in tree order (callers that report sort by span). */
export function elementRefs(node: unknown): Locator[] {
  const out: Locator[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const obj = value as { type?: unknown; kind?: unknown };
    if (obj.type === 'Locator' && obj.kind === 'element') {
      out.push(value as Locator);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(node);
  return out;
}

/** `node` with every `element` reference replaced by the declared locator, keeping the
 *  reference's own span — so a step that fails still points at the line that used the name, not
 *  at the declaration. A name `lookup` does not know is left as it was; the runtime then refuses
 *  it with the checker's sentence, which is the path `tflw run` takes for anyone who never ran
 *  `tflw check`. Returns the same object when nothing under it changed. */
export function inlineElements<T>(node: T, lookup: ReadonlyMap<string, Locator>): T {
  if (lookup.size === 0) return node;
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const r = rewrite(item);
        if (r !== item) changed = true;
        return r;
      });
      return changed ? next : value;
    }
    if (value === null || typeof value !== 'object') return value;
    const obj = value as { type?: unknown; kind?: unknown; value?: { value?: unknown }; span?: unknown };
    if (obj.type === 'Locator' && obj.kind === 'element') {
      const decl = lookup.get(String(obj.value?.value));
      return decl ? { ...decl, span: obj.span } : value;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const r = rewrite(child);
      if (r !== child) changed = true;
      next[key] = r;
    }
    return changed ? next : value;
  };
  return rewrite(node) as T;
}

/** A file's own `element` declarations as a lookup, first declaration winning — `TF035` has
 *  already refused a program that declares one name twice, so "first" only matters to a caller
 *  that skipped the checker. */
export function elementsOf(program: Program): Map<string, Locator> {
  const out = new Map<string, Locator>();
  for (const e of program.elements ?? []) if (!out.has(e.name)) out.set(e.name, e.locator);
  return out;
}

