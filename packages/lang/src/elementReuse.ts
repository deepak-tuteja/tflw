// `M247` `D` (`D1356`) — the reuse pass's locator half: a raw `css`/`xpath` selector written in two
// or more files is offered as one `element` declaration, with every site rewritten to the bare name.
//
// It shares `detectReuse`'s contract rather than its code. Both are advisory (`tflw check` prints
// them, never fails on them), both are applied only by `tflw refactor apply <id>`, and both number
// their hints in one `RF` sequence — this pass continues from where the action pass stopped, so one
// id names one hint whichever kind it is. The action pass extracts *sequences of steps*; this one
// extracts a single *operand*, which is why it needs none of that pass's framing rules: a selector
// has no response scope, binds nothing, and reads nothing but the page.
//
// What is offered, deliberately narrowly:
//   - `css` and `xpath` only. `button "Save"` is already a name a reader understands; a selector is
//     the thing that breaks when the markup changes and is worth writing once.
//   - A plain string only. A selector with a `{ref}` in it is different on every call and has no
//     single declaration to extract.
//   - Two or more *files*. Repetition inside one file is a file's own business, and the point of an
//     `element` is the shared name.
//   - Not a selector some `element` in the suite already declares: that is not a new name to invent,
//     and offering one would put two names on one locator.

import type { Program } from './ast.js';
import type { Span } from './token.js';
import type { SuiteEntry } from './reuse.js';

export interface ElementReuseOccurrence {
  readonly path: string;
  /** 1-based line of the locator. */
  readonly line: number;
  /** The locator's own span — `css "…"`, keyword to closing quote — which is exactly what the
   *  rewrite replaces with the bare name. */
  readonly span: Span;
}

export interface ElementReuseHint {
  readonly id: string;
  readonly kind: 'element';
  readonly locatorKind: 'css' | 'xpath';
  /** The selector as it is written inside the quotes. */
  readonly selector: string;
  readonly elementName: string;
  readonly occurrences: readonly ElementReuseOccurrence[];
  /** `shared/elements.tflw` — cwd-relative, POSIX separators. Appended to when it exists. */
  readonly declarationFile: string;
  /** The one line to write: `element cartCount = css "[data-test=cart-count]"`. */
  readonly declaration: string;
  readonly diffPreview: string;
}

export const ELEMENT_DECLARATION_FILE = 'shared/elements.tflw';

interface RawLocator {
  readonly kind: 'css' | 'xpath';
  readonly text: string;
  /** The source text between the quotes, byte for byte — what a declaration must reproduce. */
  readonly raw: string;
  readonly span: Span;
}

/** Every plain-string `css`/`xpath` locator under `node`. The walk is structural, `elementRefs`'
 *  reason: a locator can sit in any of a dozen positions and a new one should not need listing. */
function rawLocators(node: unknown, source: string): RawLocator[] {
  const out: RawLocator[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const obj = value as { type?: unknown; kind?: unknown; value?: { value: string; parts: readonly { kind: string }[]; span: Span }; span?: Span };
    if (obj.type === 'Locator' && (obj.kind === 'css' || obj.kind === 'xpath') && obj.value && obj.span) {
      if (obj.value.parts.every((p) => p.kind === 'text')) {
        const lit = obj.value.span;
        out.push({ kind: obj.kind, text: obj.value.value, raw: source.slice(lit.start.offset + 1, lit.end.offset - 1), span: obj.span });
      }
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(node);
  return out;
}

/** Every locator this program declares under an `element` name, keyed the way occurrences are. */
function declaredSelectors(program: Program): Set<string> {
  const out = new Set<string>();
  for (const e of program.elements ?? []) if (e.locator.kind === 'css' || e.locator.kind === 'xpath') out.add(`${e.locator.kind}\0${e.locator.value.value}`);
  return out;
}

/** A name for a selector, from the words in it: `[data-test=cart-count]` → `cartCount`,
 *  `.checkout-btn` → `checkoutBtn`, `//nav//a[@href='/cart']` → `navCart`. The last three words
 *  at most, because a selector's specific end is the part that names the thing; `element` when
 *  there are no words at all. Never a locator keyword — the parser refuses those as names. */
export function proposeElementName(selector: string): string {
  const noise = new Set(['data', 'test', 'testid', 'id', 'class', 'div', 'span', 'button', 'input', 'a', 'li', 'ul', 'href', 'aria', 'label', 'role', 'name', 'type', 'nth', 'child', 'of', 'contains', 'text']);
  const words = (selector.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !noise.has(w));
  const picked = words.slice(-3);
  if (picked.length === 0) return 'element';
  const name = picked[0] + picked.slice(1).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  return ['button', 'field', 'text', 'list', 'css', 'xpath'].includes(name) ? `${name}El` : name;
}

function freeName(base: string, used: Set<string>): string {
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  used.add(name);
  return name;
}

/**
 * The locator half of the reuse pass. `firstNumber` is where the `RF` sequence continues — pass
 * the action pass's hint count plus one, so one `refactor apply <id>` namespace covers both.
 * Deterministic: groups are ordered by their first occurrence (path, then line), the action pass's
 * rule, so an id is stable within one scan.
 */
export function detectElementReuse(entries: readonly SuiteEntry[], firstNumber = 1): ElementReuseHint[] {
  const already = new Set<string>();
  const usedNames = new Set<string>();
  for (const e of entries) {
    for (const key of declaredSelectors(e.program)) already.add(key);
    for (const el of e.program.elements ?? []) usedNames.add(el.name);
  }

  const groups = new Map<string, { kind: 'css' | 'xpath'; text: string; raw: string; occs: ElementReuseOccurrence[]; files: Set<string> }>();
  for (const e of entries) {
    // Declarations are not uses: an `element` line's own locator is where the name comes from.
    const { elements: _declared, ...uses } = e.program;
    for (const loc of rawLocators(uses, e.source)) {
      const key = `${loc.kind}\0${loc.text}`;
      if (already.has(key)) continue;
      let g = groups.get(key);
      if (!g) {
        g = { kind: loc.kind, text: loc.text, raw: loc.raw, occs: [], files: new Set() };
        groups.set(key, g);
      }
      g.occs.push({ path: e.path, line: loc.span.start.line, span: loc.span });
      g.files.add(e.path);
    }
  }

  const offered = [...groups.values()]
    .filter((g) => g.files.size >= 2)
    .map((g) => ({ ...g, occs: [...g.occs].sort((a, b) => (a.path === b.path ? a.span.start.offset - b.span.start.offset : a.path.localeCompare(b.path))) }))
    .sort((a, b) => {
      const ao = a.occs[0]!;
      const bo = b.occs[0]!;
      return ao.path === bo.path ? ao.line - bo.line : ao.path.localeCompare(bo.path);
    });

  return offered.map((g, i) => {
    const id = `RF${String(firstNumber + i).padStart(3, '0')}`;
    const elementName = freeName(proposeElementName(g.text), usedNames);
    const declaration = `element ${elementName} = ${g.kind} "${g.raw}"`;
    const sites = g.occs.map((o) => `    ${o.path}:${o.line}`).join('\n');
    const diffPreview = [
      `${id} — \`${g.kind} "${g.raw}"\` is written in ${g.files.size} files (${g.occs.length} sites):`,
      sites,
      `  proposed, in ${ELEMENT_DECLARATION_FILE}:`,
      `    ${declaration}`,
      `  each site becomes:`,
      `    - ${g.kind} "${g.raw}"`,
      `    + ${elementName}`,
    ].join('\n');
    return { id, kind: 'element' as const, locatorKind: g.kind, selector: g.text, elementName, occurrences: g.occs, declarationFile: ELEMENT_DECLARATION_FILE, declaration, diffPreview };
  });
}
