// Signature help (PLAN_M13_LSP.md Phase 2, design decision 4): `CallExpr`-shaped positions only —
// `unique(...)` (the one generator using call syntax) and a user action/JS-helper call
// (`create order(...)`). Matchers aren't call-syntax and don't need it.

import type { CallExpr, Program, Value } from '@tflw/lang';
import { findNodeAtOffset } from './findNodeAtOffset.js';

export interface SignatureHelpResult {
  readonly label: string;
  readonly parameters: readonly string[];
  readonly activeParameter: number;
  /** Set only when `parameters` fell back to positional `arg1, arg2, …` labels (the call isn't
   * declared in this file) — Phase 3's cross-file resolver can look this name up in the file's
   * `import`s/`use`s and, if found, replace the positional labels with the real ones. */
  readonly unresolvedCallName?: string;
}

/**
 * Find the innermost call containing `offset` and describe its signature. A user action call
 * resolves its parameter *names* against this file's own `ActionDecl`s (imported actions and JS
 * helpers don't have that information available without reading another file — Phase 3's concern —
 * so those fall back to positional `arg1, arg2, …` labels rather than real names).
 */
export function getSignatureHelp(program: Program, offset: number): SignatureHelpResult | null {
  const path = findNodeAtOffset(program, offset);
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i]!;
    if (node.type === 'UniquePrefixExpr') {
      return { label: 'unique(prefix)', parameters: ['prefix'], activeParameter: 0 };
    }
    if (node.type === 'CallExpr') {
      const call = node as CallExpr;
      const action = program.actions.find((a) => a.name === call.name);
      const parameters = action ? action.params : call.args.map((_, argIndex) => `arg${argIndex + 1}`);
      return {
        label: `${call.name}(${parameters.join(', ')})`,
        parameters,
        activeParameter: activeParamIndex(call.args, offset, parameters.length),
        ...(action ? {} : { unresolvedCallName: call.name }),
      };
    }
  }
  return null;
}

function activeParamIndex(args: readonly Value[], offset: number, paramCount: number): number {
  let index = 0;
  for (const arg of args) {
    if (offset <= arg.span.end.offset) break;
    index++;
  }
  return Math.min(index, Math.max(paramCount - 1, 0));
}
