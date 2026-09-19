// **What holds what** — `M214` `A4` (`D1117`).
//
// The pane had `remove` for a header, a subset entry, a threshold and a table row, and for nothing
// a person actually writes: not a request, not an assertion, not a `let`. Four rounds of authoring
// shipped with no way to unwrite a line, which is the fourth of the five complaints this round
// exists to answer.
//
// **A DELETE IS REFUSED RATHER THAN WARNED, AND THE MEASUREMENT IS WHY.** 760 `capture`/`let`
// bindings exist across the 97-file corpus and **617 of them — 81% — are read later in the same
// test.** A gesture whose commonest outcome is a file that no longer runs is not a gesture; it is a
// trap with an undo button. So `holds()` answers *who is still holding this*, the `✕` refuses while
// anybody is, and the refusal **names the first dependent as a link** — inline, never on hover,
// because a disabled control that does not say why is the exact pattern this round was opened to
// remove.
//
// **IT READS THE PRINTED STATEMENT AND NOT THE TREE, AND THAT IS A DECISION WITH A COST.** The
// language interpolates by name in one syntax — `{name}` — everywhere a value can appear: a path,
// a header value, a body, a `let`'s own right-hand side, an operand, a `{value}` subject. Walking
// the tree for it would mean a visitor over every expression node in `ast.ts` and a new case every
// time the language grows one; asking the **printer** — which is total over all 116 kinds since
// `M201` — for the statement's own text and reading the names out of it is one rule that cannot
// fall behind the grammar.
//
// The cost is stated rather than discovered: this over-reports. A literal `"{token}"` inside a
// JSON body that is never resolved as a binding still counts as a read, and a name that appears in
// a comment does not (the printer emits none). Over-reporting is the safe direction for a refusal
// — the failure mode is *you cannot delete something you could have deleted*, and the page says
// exactly which line is holding it, so the author removes that line first. Under-reporting writes
// a file that does not run.

import { print, type Step } from '@tflw/lang';
import type { OutlineBody, OutlineRequest, OutlineStatement } from './outline';
import { statementsOf } from './outline';

/** Everything a body holds, in the order it runs — requests and statements interleaved, which is
 *  the order that matters here: *later* is what makes a read a dependency. */
export interface Ordered {
  readonly line: number;
  readonly step: number | null;
  readonly node: Step;
}

/** The name a statement binds, or `null`. Two kinds bind in this language and both spell the name
 *  the same way on the node, so this is a field read rather than a parse. */
export function bindsName(node: Step): string | null {
  if (node.type === 'LetStmt') return node.name;
  if (node.type === 'CaptureStmt') return node.name;
  return null;
}

/** Every `{name}` a statement interpolates — see this module's head for why it reads the print and
 *  not the tree. A path segment like `{orderId}` and a header value like `"Bearer {token}"` are the
 *  same syntax and are found by the same rule. */
export function readsNames(node: Step): ReadonlySet<string> {
  const out = new Set<string>();
  const printed = print(node);
  if (!printed.ok) return out;
  for (const m of printed.text.matchAll(/\{\s*([A-Za-z_]\w*)[^}]*\}/g)) out.add(m[1]!);
  return out;
}

/** The body as one ordered list — a request is a position too, because a request's path can read a
 *  binding and very often does. */
export function orderedOf(body: OutlineBody): Ordered[] {
  const rows: Ordered[] = [];
  for (const s of body.preamble) rows.push({ line: s.line, step: s.stepPath?.step ?? null, node: s.node });
  for (const r of body.requests) {
    rows.push({ line: r.line, step: r.stepPath.step, node: r.node });
    for (const s of r.attached) rows.push({ line: s.line, step: s.stepPath?.step ?? null, node: s.node });
  }
  return rows.sort((a, b) => a.line - b.line);
}

/** Why a removal is refused, and by whom. */
export interface Held {
  /** The binding still being read — what the author has to deal with first. */
  readonly name: string;
  /** The first statement that reads it, by line. A link, because *which line* is the whole of what
   *  a reader needs and scrolling to find it is not part of the answer. */
  readonly line: number;
  /** That statement as the language prints it, for the sentence. */
  readonly text: string;
}

/**
 * Whether anything **below** these lines still reads a name **they** bind.
 *
 * The two halves are deliberately asymmetric. What is being removed is a set of lines, so a read by
 * one of those same lines is not a dependency — deleting a `capture` and the `expect` that reads it
 * together is exactly what removing a request does, and refusing that would make a request
 * undeletable whenever it binds anything.
 */
export function holds(body: OutlineBody, removing: readonly number[]): Held | null {
  const going = new Set(removing);
  const rows = orderedOf(body);
  const bound = new Map<string, number>();
  for (const row of rows) {
    if (!going.has(row.line)) continue;
    const name = bindsName(row.node);
    if (name !== null) bound.set(name, row.line);
  }
  if (bound.size === 0) return null;
  for (const row of rows) {
    if (going.has(row.line)) continue;
    // Only what comes AFTER. A binding is read downstream or not at all: a statement above the one
    // being removed cannot be reading a name that does not exist yet, and a file where it looks
    // like it is has a different problem.
    const firstGoing = Math.min(...going);
    if (row.line < firstGoing) continue;
    for (const name of readsNames(row.node)) {
      if (!bound.has(name)) continue;
      const printed = print(row.node);
      return { name, line: row.line, text: printed.ok ? printed.text.split('\n')[0]! : row.node.type };
    }
  }
  return null;
}

/** What removing a request takes with it — itself, and every statement attached to it.
 *
 *  **Its attachments are not optional and the reason is the language's.** `body` means *the last
 *  response*; an `expect body.total equals 12` left behind when the request above it is gone reads
 *  whatever response ran before, silently, and may well pass. One edit, or a file that is wrong
 *  between two of them. */
export function requestRemoval(request: OutlineRequest): { lines: number[]; steps: number[] } {
  const lines = [request.line];
  const steps = [request.stepPath.step];
  for (const s of request.attached) {
    if (s.stepPath === null) continue;
    lines.push(s.line);
    steps.push(s.stepPath.step);
  }
  return { lines, steps };
}

/** A statement removes itself alone. `null` for one no index pair can name — the expects nested
 *  inside a `wait until api` block, which are not in the body's own step list. */
export function statementRemoval(statement: OutlineStatement): { lines: number[]; steps: number[] } | null {
  if (statement.stepPath === null) return null;
  return { lines: [statement.line], steps: [statement.stepPath.step] };
}

/** Every statement of a body, for callers that want the flat list without importing two modules. */
export { statementsOf };
