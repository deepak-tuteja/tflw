// Painting and checking a body — `M215` (`D1121`, `D1122`).
//
// TWO BLOCKS SHOW A JSON DOCUMENT AND NEITHER WAS COLOURED OR CHECKED. The response body is a flat
// `<pre>` of whatever the service sent, which for a real API is one minified line; the request body
// is a bare `<textarea>` whose only feedback was the write being refused with a sentence, after the
// fact, with no idea *where*. `M213` `S0b` taught this page to colour `.tflw` source and nothing
// pointed that instrument at the two places a reader spends the most time staring at a value.
//
// THE REQUEST BODY IS NOT JSON, AND THAT IS WHY THIS LEANS ON THE LANGUAGE RATHER THAN ON
// `JSON.parse`. What sits in that textarea is the language's own object literal — bare keys, and
// `{orderId}` interpolations that no JSON parser will ever accept. `highlightFragment` reads it
// correctly because it *is* tflw, and it reads real JSON correctly too, because quoted keys,
// numbers, strings and brackets are all things the lexer already knows.
//
// SO WHAT THIS ADDS IS THREE RE-ROLE RULES, NOT A SECOND PARSER (`D1121`). Measured against the
// highlighter on both shapes, three runs come back saying less than a reader needs:
//
//   1. A **quoted** key comes back `str`, a **bare** key comes back `typ`. Both are keys. In a
//      response — where every key is quoted — that painted the entire left column the same colour
//      as every string value, which is the one distinction a JSON view exists to draw.
//   2. `true`, `false` and `null` come back unclaimed, because `TOKEN_ROLE` deliberately does not
//      paint a bare `ident` (see its comment: painting every unrecognised word would make the
//      colouring say more than the language knows). In a JSON document those three words are not
//      unrecognised — they are the literals.
//   3. A bare ident alone between `{` and `}` is an interpolation, and it is the one thing in a
//      request body that is a *reference* rather than a value.
//
// Each rule is a role swap over pieces the highlighter already produced, so **reassembly stays
// exact** — `pieces(t).map(p => p.text).join('') === t` for every input, which is the invariant
// `highlight.ts` lives by and the gate asserts on both corpora.
import { highlightFragment, type Piece } from './highlight';
import { parseSource } from '@tflw/lang';

/** The literal words JSON has and the language leaves unclaimed. */
const LITERALS = new Set(['true', 'false', 'null']);

/**
 * How many bytes get painted before this gives up and hands back the text.
 *
 * **A response is whatever the service sent, and this page has met a 4 MB one** — the same
 * measurement `LEAF_CAP` exists for. Colouring means a lex, a parse and two symbol passes, on
 * every render, and the old flat `<pre>` cost none of that: adding colour to an unbounded input is
 * how a view of a big response becomes a page that stops responding. Above the cap the bytes are
 * shown exactly as they arrived, uncoloured and unlaid-out, which is what they were yesterday.
 *
 * 200 000 characters is about 4 000 lines of laid-out JSON — past what a person reads and well
 * inside what the passes do in a frame.
 */
export const PAINT_CAP = 200_000;

/** Unclaimed pieces, split into word runs and everything else, so a role can land on the word
 *  alone. The highlighter hands back `" true"` as one piece; a reader wants the space uncoloured
 *  and the word painted, and a swap cannot do that to a piece holding both. */
function words(pieces: readonly Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    if (p.role !== null || p.text === '') {
      out.push(p);
      continue;
    }
    for (const run of p.text.split(/(\w+)/)) if (run !== '') out.push({ text: run, role: null });
  }
  return out;
}

const blank = (p: Piece): boolean => p.role === null && p.text.trim() === '';

/** The next piece that is not whitespace, from `i` exclusive. */
function next(pieces: readonly Piece[], i: number): Piece | null {
  for (let j = i + 1; j < pieces.length; j += 1) if (!blank(pieces[j]!)) return pieces[j]!;
  return null;
}
function prev(pieces: readonly Piece[], i: number): Piece | null {
  for (let j = i - 1; j >= 0; j -= 1) if (!blank(pieces[j]!)) return pieces[j]!;
  return null;
}

const isOp = (p: Piece | null, text: string): boolean => p !== null && p.role === 'op' && p.text === text;

/**
 * A body — tflw's object literal or a wire JSON document — as coloured pieces.
 *
 * Never throws and never loses a byte: a text the highlighter cannot read comes back as one
 * unclaimed piece, which renders as the plain text it already was.
 */
export function pieces(text: string): readonly Piece[] {
  if (text.length > PAINT_CAP) return [{ text, role: null }];
  const base = words(highlightFragment(text));
  return base.map((p, i) => {
    // 1 — anything immediately before a `:` is a key, however it was spelled.
    if (isOp(next(base, i), ':') && (p.role === 'str' || p.role === 'typ' || (p.role === null && /^\w+$/.test(p.text)))) {
      return { text: p.text, role: 'typ' as const };
    }
    if (p.role !== null || !/^\w+$/.test(p.text)) return p;
    // 2 — the three words a JSON document spells that the language leaves unclaimed.
    if (LITERALS.has(p.text)) return { text: p.text, role: 'kw' as const };
    // 3 — `{orderId}`: a name standing alone inside braces is a reference, not a value.
    if (isOp(prev(base, i), '{') && isOp(next(base, i), '}')) return { text: p.text, role: 'var' as const };
    return p;
  });
}

/**
 * `text`, laid out across lines — the same document, with the whitespace between its tokens
 * decided rather than inherited.
 *
 * **Not `JSON.parse` + `JSON.stringify(_, null, 2)`, and the reason is a number.** That round trip
 * is the obvious way to pretty-print, and it reinterprets every literal on the way through: a
 * response carrying an id above 2^53 comes back with a *different id*, silently, in a view whose
 * only job is to show what the service sent. It also cannot read the request body at all, which is
 * the language's object literal — bare keys, `{orderId}` interpolations — and not JSON.
 *
 * So this is a whitespace pass over the pieces, in the same family as `tflw fmt` (`D994`): no
 * literal is re-read, no token is reordered, and the only thing invented is the indentation. What
 * it costs is that this does not *validate* — a body that is nonsense is laid out as nonsense —
 * which is `bodyProblem`'s job below, and the two are shown together.
 *
 * `null` when there is nothing to do: not a document, or already laid out this way.
 */
export function laidOut(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > PAINT_CAP) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  const all = pieces(trimmed);
  const solid = all.filter((p) => !blank(p));
  if (solid.length < 3) return null;
  const out: string[] = [];
  /** One entry per open bracket: does it break across lines? An interpolation never does. */
  const stack: boolean[] = [];
  const pad = (): string => '\n' + '  '.repeat(stack.length);
  for (const [i, p] of solid.entries()) {
    const after = solid[i + 1] ?? null;
    if (p.role === 'op' && (p.text === '{' || p.text === '[')) {
      const closer = p.text === '{' ? '}' : ']';
      /* `{}` and `[]` stay whole, and so does `{orderId}` — a brace whose contents are not a
         `key:` pair is an interpolation, which is the same two-token test `parser.ts` uses to tell
         an object literal from an expression (`startsObjectLiteral`). Breaking one across lines
         would still parse and would read as a shape the author never wrote. */
      const empty = after !== null && after.role === 'op' && after.text === closer;
      const isObject = after !== null && solid[i + 2] !== undefined && solid[i + 2]!.role === 'op' && solid[i + 2]!.text === ':';
      const breaks = !empty && (p.text === '[' || isObject);
      out.push(p.text);
      stack.push(breaks);
      if (breaks) out.push(pad());
      continue;
    }
    if (p.role === 'op' && (p.text === '}' || p.text === ']')) {
      const breaks = stack.pop() ?? false;
      if (breaks) {
        while (out.length > 0 && out[out.length - 1]!.startsWith('\n')) out.pop();
        out.push(pad());
      }
      out.push(p.text);
      continue;
    }
    if (p.role === 'op' && p.text === ',') {
      out.push(',');
      out.push(stack[stack.length - 1] ? pad() : ' ');
      continue;
    }
    if (p.role === 'op' && p.text === ':') {
      out.push(': ');
      continue;
    }
    out.push(p.text);
  }
  const laid = out.join('');
  return laid === text ? null : laid;
}

/** Where a body stops making sense, and what the language says about it. Offsets are into the
 *  text as given, so a caller can slice it into three runs and underline the middle one. */
export interface BodyProblem {
  readonly message: string;
  readonly code: string;
  readonly from: number;
  readonly to: number;
}

/** The wrapper `parseValueText` uses, spelled once here so the offsets below are arithmetic rather
 *  than a guess. A value is read as the right-hand side of a `let` inside a test, because that is
 *  the one position in the grammar where any value may stand alone. */
const PREFIX = 'test "_"\n  let _v = ';

/** An absolute offset in `source` for a 1-based line/column. */
function offsetOf(source: string, line: number, column: number): number {
  const lines = source.split('\n');
  let at = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i += 1) at += lines[i]!.length + 1;
  return at + (column - 1);
}

/**
 * What is wrong with this body, and **where** — `D1122`.
 *
 * The builder already refuses a body it cannot read, and until now that refusal arrived as a
 * sentence with no position, after a write, by which time the author had typed three more fields.
 * This asks the same question of the same grammar, on every keystroke, and keeps the span.
 *
 * **It answers about the value alone.** The span comes back addressed to the wrapper, so it is
 * converted to an absolute offset and the wrapper's length subtracted; a diagnostic landing before
 * the value (which nothing in the grammar produces for a well-formed prefix) is clamped to 0
 * rather than rendered as a negative slice.
 *
 * `null` means *nothing to say*, which covers both a body that reads cleanly and an empty one —
 * an empty field is not a mistake, it is a field nobody has filled in yet.
 */
export function bodyProblem(text: string): BodyProblem | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > PAINT_CAP) return null;
  const source = `${PREFIX}${trimmed}\n`;
  const { diagnostics } = parseSource(source);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (!error) return null;
  const lead = text.length - text.trimStart().length;
  const from = Math.max(0, offsetOf(source, error.span.start.line, error.span.start.column) - PREFIX.length) + lead;
  const to = Math.max(from + 1, offsetOf(source, error.span.end.line, error.span.end.column) - PREFIX.length + lead);
  return { message: error.message, code: error.code, from, to: Math.min(to, text.length) };
}
