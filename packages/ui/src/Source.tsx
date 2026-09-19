// Drawing coloured `.tflw` source (`M213` `S0b`). `highlight.ts` decides what each run of bytes
// IS; this decides nothing and only renders it.
//
// ONE `<span>` PER PIECE, AND PLAIN TEXT FOR THE UNCLAIMED RUNS. A piece with no role is emitted
// as a bare string rather than as an unstyled span, so the DOM carries only the elements that mean
// something — whitespace and indentation stay text, which is what they are.
import type { ReactElement, ReactNode } from 'react';
import { highlightFragment, highlightLines, type Piece } from './highlight';

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
