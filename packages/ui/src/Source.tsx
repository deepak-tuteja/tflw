// Drawing coloured `.tflw` source (`M213` `S0b`). `highlight.ts` decides what each run of bytes
// IS; this decides nothing and only renders it.
//
// ONE `<span>` PER PIECE, AND PLAIN TEXT FOR THE UNCLAIMED RUNS. A piece with no role is emitted
// as a bare string rather than as an unstyled span, so the DOM carries only the elements that mean
// something — whitespace and indentation stay text, which is what they are.
import type { ReactElement, ReactNode } from 'react';
import { highlightFragment, highlightLines, type Piece } from './highlight';
import { pieces, type BodyProblem } from './jsonview';

const draw = (pieces: readonly Piece[], keyPrefix: string): ReactNode[] =>
  pieces.map((p, i) => (p.role === null ? p.text : <span key={`${keyPrefix}-${i}`} className={`t-${p.role}`}>{p.text}</span>));

/**
 * A whole file, one `<span data-source-line>` per physical line.
 *
 * **The line spans are not this component's idea and must not be dropped.** `SourcePanel`'s index
 * scrolls to a declaration by querying `[data-source-line="N"]`, so the line is the thing with a
 * position; the colouring nests inside it. And the panel's own comment records that this `<pre>`'s
 * `textContent` is the file byte for byte — `D985`'s projection rule, which every page gate reading
 * `[data-preview]` rests on. `highlightLines` guarantees the reassembly; this keeps the shape.
 */
export function SourceText({ text }: { readonly text: string }): ReactElement {
  const lines = highlightLines(text);
  return (
    <>
      {lines.map((pieces, i) => (
        <span key={i} data-source-line={i + 1}>
          {draw(pieces, String(i))}
          {i < lines.length - 1 ? '\n' : ''}
        </span>
      ))}
    </>
  );
}

/** One statement, as `ComposePane` draws a collapsed row: no line spans, no declaration around it. */
export function StatementText({ text }: { readonly text: string }): ReactElement {
  return <>{draw(highlightFragment(text), 's')}</>;
}

/**
 * A request or response body, coloured — and underlined where it stops making sense (`M215`).
 *
 * The same `draw` as everything above it, over `jsonview`'s pieces rather than the highlighter's
 * raw ones, so a key reads as a key whether it was quoted or bare and `true`/`null` read as the
 * literals they are.
 *
 * **The squiggle is applied to pieces, never to a re-highlighted slice.** Splitting the text at the
 * problem's offsets and colouring the three parts separately would re-lex each one out of context —
 * an unterminated string in part two, a key with no colon in part one — so the colouring would
 * change *because* something was wrong, which is the opposite of what a reader needs. Instead the
 * pieces are computed once over the whole text and the ones overlapping the span are marked, with a
 * straddling piece split at the boundary so the underline lands where the language put it.
 */
export function BodyText({ text, problem }: { readonly text: string; readonly problem: BodyProblem | null }): ReactElement {
  const all = pieces(text);
  if (problem === null) return <>{draw(all, 'b')}</>;
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const p of all) {
    const start = at;
    const end = at + p.text.length;
    at = end;
    // The three runs this piece contributes: before the span, inside it, after it. Any of them may
    // be empty, and an empty one is not emitted.
    const cuts: readonly (readonly [string, boolean])[] = [
      [p.text.slice(0, Math.max(0, Math.min(p.text.length, problem.from - start))), false],
      [p.text.slice(Math.max(0, problem.from - start), Math.max(0, Math.min(p.text.length, problem.to - start))), true],
      [p.text.slice(Math.max(0, Math.min(p.text.length, problem.to - start))), false],
    ];
    if (end <= problem.from || start >= problem.to) {
      out.push(p.role === null ? p.text : <span key={`b${n}`} className={`t-${p.role}`}>{p.text}</span>);
      n += 1;
      continue;
    }
    for (const [run, bad] of cuts) {
      if (run === '') continue;
      const cls = `${p.role === null ? '' : `t-${p.role}`}${bad ? ' squiggle' : ''}`.trim();
      out.push(cls === '' ? run : <span key={`b${n}`} className={cls}>{run}</span>);
      n += 1;
    }
  }
  return <>{out}</>;
}
