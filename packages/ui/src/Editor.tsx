// The page's one text editor — `M241` `A` (`D1321`). Source edits a `.tflw` file with it and Config
// edits `tflw.config` and the accepted-findings document; nothing else on the page is a text editor.
//
// CODEMIRROR 6, AND FOUR OF ITS PACKAGES. `state`, `view` and `language` were declared since `M192`
// and imported by nothing; `commands` joined here because an editor without undo is not an editor.
// All four are MIT by their own `LICENSE` files (read 2026-09-26, `PLAN_M241_AUTHORING.md` §0), and
// the bundle's notices generator carries each one's text into `cli/dist` the day it is imported.
//
// ONE LEXER, TWO READERS. The colours are `highlight.ts`'s — the lexer and the semantic pass the
// read-only views already use — mapped onto `Decoration.mark`s by a view plugin. A `StreamLanguage`
// would have been a second tokenizer written line by line, and tflw's lexer is whole-file and
// indentation-sensitive, so the two would disagree about exactly the lines worth colouring. The
// classes are the same `t-<role>` the rest of the page draws, so a theme colours both at once.
//
// THE DIAGNOSTICS ARE THE CALLER'S. `diagnose()` is the CLI's checker running in the browser
// (`D1052`); the caller passes its answer in and this draws it — a squiggle on the span, the code
// and message on the line's `title`. It never decides what is wrong, so the page cannot hold two
// opinions about one file.
//
// THE TEXT IS THE CALLER'S TOO. `value` in, `onChange` out, and a `value` that differs from the
// document replaces it: the buffer lives in `App` (`D1079`'s one buffer), which is what makes
// Compose and Source two views of one draft rather than two drafts.
import { useEffect, useRef } from 'react';
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import type { Diagnostic, Dialect } from '@tflw/lang';
import { highlightLines } from './highlight';

/** `null` is text the page does not colour — the accepted-findings document is JSON, not tflw. */
export type EditorDialect = Dialect | null;

function colours(dialect: Dialect): Extension {
  const build = (doc: string): DecorationSet => {
    const out = new RangeSetBuilder<Decoration>();
    let at = 0;
    for (const line of highlightLines(doc, dialect)) {
      for (const piece of line) {
        if (piece.role !== null && piece.text.length > 0) out.add(at, at + piece.text.length, Decoration.mark({ class: `t-${piece.role}` }));
        at += piece.text.length;
      }
      at += 1; // the newline `highlightLines` leaves to its caller
    }
    return out.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view.state.doc.toString());
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.state.doc.toString());
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const setProblems = StateEffect.define<readonly Diagnostic[]>();

/** Diagnostics as marks. A span the document no longer reaches is clamped, never thrown on — the
 *  caller's answer is always one keystroke behind the text it describes. */
const problems = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setProblems)) continue;
      const doc = tr.state.doc;
      const marks = e.value
        .map((d) => {
          const line = doc.line(Math.min(Math.max(d.span.start.line, 1), doc.lines));
          const from = Math.min(line.from + Math.max(d.span.start.column - 1, 0), line.to);
          const endLine = doc.line(Math.min(Math.max(d.span.end.line, 1), doc.lines));
          let to = Math.min(endLine.from + Math.max(d.span.end.column - 1, 0), endLine.to);
          if (to <= from) to = Math.min(line.to, from + 1);
          if (to <= from) return null; // an empty line: nothing to underline
          return Decoration.mark({ class: `squiggle ${d.severity}`, attributes: { title: `${d.code} — ${d.message}`, 'data-editor-diagnostic': d.code } }).range(from, to);
        })
        .filter((r) => r !== null)
        .sort((a, b) => a.from - b.from);
      next = Decoration.set(marks);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface EditorProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly dialect: EditorDialect;
  readonly diagnostics?: readonly Diagnostic[];
  /** Attributes for the element that holds the text — its accessible name and the hooks the page's
   *  gates read (`data-preview`, `data-api-config-text`). */
  readonly contentAttributes: Readonly<Record<string, string>>;
  /** A line to bring into view and select, when it changes. */
  readonly focusLine?: number | null;
  readonly className?: string;
}

export function Editor({ value, onChange, dialect, diagnostics = [], contentAttributes, focusLine = null, className }: EditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  // The latest callback, read by the listener the editor was built with — rebuilding the editor
  // on every render would drop the undo history and the selection.
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    if (host.current === null) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          // Tab indents, because tflw's blocks are indentation: an editor where Tab leaves the
          // text cannot write the language. Escape first and Tab then moves focus on, which is
          // CodeMirror's own rule for the keyboard trap this would otherwise be.
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentUnit.of('  '),
          EditorView.contentAttributes.of({ ...contentAttributes, spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changed.current(u.state.doc.toString());
            if (u.docChanged || u.viewportChanged) u.view.contentDOM.setAttribute('data-editor-lines', String(u.state.doc.lines));
          }),
          problems,
          ...(dialect === null ? [] : [colours(dialect)]),
        ],
      }),
    });
    v.contentDOM.setAttribute('data-editor-lines', String(v.state.doc.lines));
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The dialect and the content's attributes are what the editor IS; a change to either is a
    // different editor. The text is not — it arrives through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect, JSON.stringify(contentAttributes)]);

  useEffect(() => {
    const v = view.current;
    if (v === null) return;
    const now = v.state.doc.toString();
    if (now !== value) v.dispatch({ changes: { from: 0, to: now.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setProblems.of(diagnostics) });
  }, [diagnostics]);

  useEffect(() => {
    const v = view.current;
    if (v === null || focusLine === null) return;
    const line = v.state.doc.line(Math.min(Math.max(focusLine, 1), v.state.doc.lines));
    v.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    v.focus();
    // Only when the line asked for changes — typing must not snatch the selection back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLine]);

  return <div ref={host} className={className === undefined ? 'editor' : `editor ${className}`} data-editor={dialect ?? 'plain'} />;
}

/** Scroll an editor inside `root` to `line` without moving its selection — the Source index. */
export function scrollEditorTo(root: HTMLElement | null, line: number): void {
  const dom = root?.querySelector('.cm-editor');
  if (!(dom instanceof HTMLElement)) return;
  const v = EditorView.findFromDOM(dom);
  if (v === null) return;
  const at = v.state.doc.line(Math.min(Math.max(line, 1), v.state.doc.lines));
  // **Three moves, because the first one alone did nothing.** CodeMirror sets aside a scroll
  // request while the editor is outside the window — measured: at 900×300 the editor sits below
  // the fold and `scrollIntoView` left `scrollTop` at 0. So the editor is brought into the window,
  // the scroller is placed from CodeMirror's own line geometry (`lineBlockAt` answers for a line it
  // has not drawn), and the request is then made for the exact centring once the line is drawn.
  v.dom.scrollIntoView({ block: 'nearest' });
  const block = v.lineBlockAt(at.from);
  v.scrollDOM.scrollTop = Math.max(0, block.top + block.height / 2 - v.scrollDOM.clientHeight / 2);
  v.dispatch({ effects: EditorView.scrollIntoView(at.from, { y: 'center' }) });
}
