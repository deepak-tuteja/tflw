// Colouring `.tflw` source for the page (`M213` `S0b`, `M213-10`).
//
// WHY THIS EXISTS. The four themes were chosen from a workbench whose central claim was that
// *tflw declares four hues and the pane needs about nine, because it must colour what a token is
// and what a result was at once*. Then `S0` landed the tokens into an app that painted **three**
// distinct text colours on the whole Compose pane, because nothing here could colour a word: the
// source view is a flat `<pre>` and `.stmt-text` is a bare `<code>`. Two of the four themes —
// `Instrument`, whose thesis is *syntax by lightness so hue can mean state*, and `Terminal`, whose
// thesis is the exact opposite — were indistinguishable in the one respect that defines them.
//
// THE LANGUAGE SUPPLIES ALL NINE KINDS, THROUGH THREE CHANNELS, AND THE THIRD IS THE ONE I FIRST
// SAID DID NOT EXIST. The scoping note for `M213-10` recorded that comments were unreachable,
// because `TokenType` has no comment member — the lexer consumes them without emitting a token so
// the parser can stay indentation-agnostic. That is true of the *token stream* and false of the
// lexer: `M191`/`D994` added `LexResult.lines`, one `LineInfo` per physical line carrying exactly
// the trivia the token stream drops — the indent, and the comment. It was added for the formatter
// and read by nothing else. So:
//
//   1. `collectSemanticTokens` — keyword, operator, type, function, number, variable, parameter,
//      property. The precise pass: it knows an object-literal key from a value by the same
//      colon-lookahead `parser.ts` uses, and it knows a variable from a parameter through the
//      symbol table.
//   2. `lex().tokens` — string, path, number, tag, and the punctuation. What the semantic pass
//      does not claim, the token stream still names.
//   3. `lex().lines` — the comments.
//
// NINE KINDS, SEVEN HUES, AND THE COLLAPSE IS STATED RATHER THAN HIDDEN. The themes define seven
// syntax colours because the workbench did, and the workbench's values are the source of truth
// (`§3`). The mapping groups by what a reader is being told, not by what the producer called it:
//
//   `kw`  keyword                        the language's own words
//   `str` string, path                   a literal you typed
//   `num` number                         a literal that is a quantity
//   `typ` type, function, property, tag   the name of a THING — a matcher, an action, an object key
//   `var` variable, parameter             the name of a VALUE
//   `op`  operator, punctuation           structure
//   `com` comment                         prose
//
// The cost is real and worth naming: an action name and a matcher name read alike, and so do a
// string and a path. Both pairs are distinguishable by position in every context they occur in,
// which is why they were the two chosen to collapse.
//
// THE INVARIANT THIS MODULE LIVES OR DIES BY. `SourcePanel`'s `<pre>` is a projection of the file
// and `D985` says the file is the only truth — its own comment records that `textContent` there is
// the file byte for byte, and every gate reading `[data-preview]` asserts it. So the pieces this
// returns must **reassemble to the source exactly**, including whitespace, including the bytes no
// span claimed. That is asserted over this repository's whole `.tflw` corpus rather than over a
// fixture, because a span that is off by one on a construct nobody wrote a fixture for is exactly
// the defect that would otherwise ship.
//
// IT NEVER THROWS. A file that does not parse is a first-class thing on this page — the explorer
// badges it, the landing stops counting it, and the reader opens it to find out why. Colour is the
// least important thing about that file, so any failure below falls back to the uncoloured text
// rather than taking the panel down with it. **The `catch` is a boundary guard with no observed
// trigger**: `parseSource` never throws by contract and nothing in this repository's corpus has
// made the two symbol passes throw either, so the test that says a broken file still renders every
// byte exercises the *normal* path, not this one. Said plainly rather than left to read as covered.
import { lex, parseSource, collectSymbols, collectSemanticTokens, type Dialect, type SemanticTokenType } from '@tflw/lang';

export type Role = 'kw' | 'str' | 'num' | 'typ' | 'var' | 'op' | 'com';

/** A run of source, and what it is. `role: null` is unclaimed text — whitespace, and any lexeme
 *  neither pass named. It is a piece like any other so that reassembly is total. */
export interface Piece {
  readonly text: string;
  readonly role: Role | null;
}

const SEMANTIC_ROLE: Record<SemanticTokenType, Role> = {
  keyword: 'kw',
  operator: 'op',
  type: 'typ',
  function: 'typ',
  property: 'typ',
  number: 'num',
  variable: 'var',
  parameter: 'var',
};

/** The lexer's own types, for what the semantic pass leaves unclaimed. `ident` is deliberately
 *  absent: a bare name the semantic pass did not recognise is not a *kind*, and painting every
 *  unrecognised word would make the colouring say more than the language knows. */
const TOKEN_ROLE: Partial<Record<string, Role>> = {
  string: 'str',
  path: 'str',
  number: 'num',
  tag: 'typ',
  lbrace: 'op', rbrace: 'op', lbracket: 'op', rbracket: 'op', lparen: 'op', rparen: 'op',
  colon: 'op', comma: 'op', dot: 'op', equals: 'op', plus: 'op', minus: 'op', star: 'op',
  slash: 'op', pipe: 'op', percent: 'op',
};

interface Span { readonly start: number; readonly end: number; readonly role: Role }

/**
 * Every line of `source`, as coloured pieces. One array per physical line, **without** its
 * newline — the caller owns the line separators, because `SourcePanel` already renders one
 * `<span data-source-line>` per line for the index to scroll to and this has to drop into that
 * shape rather than replace it.
 *
 * `source.split('\n')` and this function always agree on line count.
 */
export function highlightLines(source: string, dialect: Dialect = 'test'): readonly (readonly Piece[])[] {
  const plain = (): readonly (readonly Piece[])[] => source.split('\n').map((l) => (l === '' ? [] : [{ text: l, role: null }]));
  let spans: Span[];
  try {
    spans = collectSpans(source, dialect);
  } catch {
    return plain();
  }
  return sliceByLine(source, spans);
}

/** One statement's printed text, as coloured pieces. `ComposePane` draws a collapsed statement as
 *  a single `<code>`, so this is the same question asked of a fragment rather than of a file.
 *
 *  **A fragment still gets its keywords, and that is a property of `collectSemanticTokens` rather
 *  than luck.** `api GET /items` on its own is a step with no declaration around it, so
 *  `parseSource` recovers rather than parses and the symbol table comes back thin. The keyword
 *  half survives anyway because that pass is *lexer-driven* — a flat lex classified against the
 *  grammar's own wordlists, needing no AST. What a fragment can lose is the symbol-derived half,
 *  variable and parameter names, which a collapsed one-line statement rarely shows. */
export function highlightFragment(text: string, dialect: Dialect = 'test'): readonly Piece[] {
  const lines = highlightLines(text, dialect);
  if (lines.length === 1) return lines[0]!;
  // A fragment carrying an inline body is several lines; the newlines come back so a caller that
  // renders it into one element still shows what the author wrote.
  const out: Piece[] = [];
  lines.forEach((l, i) => {
    out.push(...l);
    if (i < lines.length - 1) out.push({ text: '\n', role: null });
  });
  return out;
}

function collectSpans(source: string, dialect: Dialect): Span[] {
  const lexed = lex(source);
  const spans: Span[] = [];
  const claimed: Array<[number, number]> = [];

  // 1. The semantic pass first, because it is the precise one — it separates an object key from a
  //    value and a parameter from a variable, which the token stream cannot.
  const { program } = parseSource(source);
  const symbols = collectSymbols(program, source);
  for (const t of collectSemanticTokens(source, symbols, dialect)) {
    const role = SEMANTIC_ROLE[t.type];
    if (!role) continue;
    spans.push({ start: t.span.start.offset, end: t.span.end.offset, role });
    claimed.push([t.span.start.offset, t.span.end.offset]);
  }

  // 2. The token stream for what it did not claim.
  const overlaps = (a: number, b: number): boolean => claimed.some(([s, e]) => a < e && s < b);
  for (const tok of lexed.tokens) {
    const role = TOKEN_ROLE[tok.type];
    if (!role) continue;
    const start = tok.span.start.offset;
    const end = tok.span.end.offset;
    if (end <= start || overlaps(start, end)) continue;
    spans.push({ start, end, role });
  }

  // 3. The comments, from the channel the token stream drops them into.
  //
  //    A comment-only line starts at its indent. A TRAILING comment has no recorded offset, so it
  //    is found as the first `#` after the last token that ends on that line — which is why this
  //    reads the token spans rather than scanning the text: a `#` inside a string or a path is not
  //    a comment, and searching from the end of the last token steps over every one of them
  //    without this file having to know what a string looks like.
  const lineEnd = (i: number): number => (i + 1 < lexed.lines.length ? lexed.lines[i + 1]!.offset - 1 : source.length);
  for (let i = 0; i < lexed.lines.length; i++) {
    const info = lexed.lines[i]!;
    if (info.comment === undefined) continue;
    const end = lineEnd(i);
    let from = info.offset + info.indent;
    if (info.kind === 'code') {
      let lastEnd = from;
      for (const tok of lexed.tokens) {
        const s = tok.span.start.offset;
        if (s >= info.offset && s < end && tok.span.end.offset > lastEnd) lastEnd = tok.span.end.offset;
      }
      from = lastEnd;
    }
    const hash = source.indexOf('#', from);
    if (hash === -1 || hash >= end) continue;
    spans.push({ start: hash, end, role: 'com' });
  }

  // Earliest first, and an overlapping span is **dropped rather than trimmed** — a trimmed span is
  // a colour applied to half a lexeme, which reads as a defect rather than as less information.
  // That guard is not decoration: measured over both repositories' 179 `.tflw` files it fires **67
  // times across 11 of them**, because an action name is multi-word and may contain a keyword, so
  // `sleep and retry` comes back as `function` for the whole name AND `function`/`keyword` for its
  // interior words. Without the drop those bytes are emitted twice.
  //
  // The tie-break beside it (`b.end - a.end`, longer first) is **arbitrary and says so**: measured
  // over the same 179 files, the number of same-start-different-end groups is **0**. It is here to
  // make the sort total rather than because anything depends on which way it goes, and a comment
  // claiming a reason would be inventing one.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at || s.end <= s.start || s.end > source.length) continue;
    kept.push(s);
    at = s.end;
  }
  return kept;
}

function sliceByLine(source: string, spans: readonly Span[]): readonly (readonly Piece[])[] {
  const out: Piece[][] = [];
  let line: Piece[] = [];
  let cursor = 0;
  let si = 0;

  /** Emit `[from, to)` of the source with one role, breaking at every newline. */
  const emit = (from: number, to: number, role: Role | null): void => {
    let a = from;
    while (a < to) {
      const nl = source.indexOf('\n', a);
      const stop = nl === -1 || nl >= to ? to : nl;
      if (stop > a) line.push({ text: source.slice(a, stop), role });
      if (stop === to) break;
      out.push(line);
      line = [];
      a = stop + 1;
    }
  };

  while (si < spans.length) {
    const s = spans[si]!;
    if (s.start > cursor) emit(cursor, s.start, null);
    emit(s.start, s.end, s.role);
    cursor = s.end;
    si++;
  }
  if (cursor < source.length) emit(cursor, source.length, null);
  out.push(line);
  return out;
}
