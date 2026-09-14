// `tflw fmt` — the formatter. `M191` (`D994`–`D997`), PLAN_M191_TFLW_FMT.md.
//
// A function over the lexer's token stream, not a printer over the AST (`D994`): the same tokens
// come out in the same order and only the whitespace between them is decided here. Comments never
// move relative to code (`D996`). Every rule is checkable by the round-trip in `roundTrip` below —
// `tokens(format(s))` equals `tokens(s)` with trivia excluded, comments equal in text and order,
// and `format` is idempotent — which is what lets the rules be opinionated (`D995`) without a
// preserve zone. Three declared exceptions, each where the same two tokens mean two things and
// the parser is what tells them apart: the space after a `minus`/`plus` (unary and binary —
// `price: -1`, `today - 10 days`, `than -5`), the space between a number and the ident after it
// (`4s` is a duration and `4 s` is `TF023`; `3 seconds` must keep its space), and the space
// between an ident and a `[` (`body[0]` is an index, `equals [1, 2]` is a list). All three are
// kept as written.
import { lex, type LexResult, type LineInfo } from './lexer.js';
import type { Token } from './token.js';

export const INDENT = '  ';

export interface FormatResult {
  /** The formatted source, or the input unchanged when `ok` is false. */
  readonly formatted: string;
  readonly ok: boolean;
  /** Why the input was left alone: a file that does not lex is not formatted. */
  readonly reason?: string;
}

const OPENERS = new Set(['lbrace', 'lbracket']);
const CLOSERS = new Set(['rbrace', 'rbracket']);

/** Format one source text. */
export function format(source: string): FormatResult {
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lexed: LexResult = lex(src);
  const error = lexed.diagnostics.find((d) => d.severity === 'error');
  if (error) return { formatted: source, ok: false, reason: `${error.code} at ${error.span.start.line}:${error.span.start.column}: ${error.message}` };

  // Tokens by physical line, with the block level of each line's first token.
  const byLine = new Map<number, Token[]>();
  const levelAt = new Map<number, number>();
  let level = 0;
  for (const t of lexed.tokens) {
    if (t.type === 'indent') { level += 1; continue; }
    if (t.type === 'dedent') { level -= 1; continue; }
    if (t.type === 'newline' || t.type === 'eof') continue;
    const line = t.span.start.line;
    let list = byLine.get(line);
    if (!list) { list = []; byLine.set(line, list); levelAt.set(line, level); }
    list.push(t);
  }

  const lines = lexed.lines;
  const codeLines = lines.filter((l) => l.kind === 'code' && !l.continuation);
  const out: string[] = [];
  let pendingBlank = false;
  let prevCode: { level: number; indent: number } | null = null;
  let depth = 0; // open brackets carried across the physical lines of one logical line
  let base = 0; // the block level of the logical line's first physical line

  const emit = (text: string) => {
    if (pendingBlank && out.length > 0) out.push('');
    pendingBlank = false;
    out.push(text);
  };

  for (let i = 0; i < lines.length; i++) {
    const info = lines[i]!;
    if (info.kind === 'blank') { pendingBlank = true; continue; }

    if (info.kind === 'comment') {
      let lvl: number;
      if (info.continuation) {
        lvl = base + depth;
      } else {
        const next = codeLines.find((l) => l.line > info.line);
        const nextLevel = next ? levelAt.get(next.line) ?? 0 : 0;
        // `D996`: the next code line's level — unless the author put the comment deeper than the
        // line that follows it (or nothing follows it) and at least as deep as the line before,
        // which is an end-of-block comment and keeps the block it closes.
        const closesBlock = prevCode !== null && info.indent > (next?.indent ?? -1) && info.indent >= prevCode.indent;
        lvl = closesBlock ? prevCode!.level : nextLevel;
      }
      emit(INDENT.repeat(lvl) + info.comment!.trimEnd());
      continue;
    }

    const tokens = byLine.get(info.line) ?? [];
    let lvl: number;
    if (info.continuation) {
      const startsWithCloser = tokens.length > 0 && CLOSERS.has(tokens[0]!.type);
      lvl = base + depth - (startsWithCloser ? 1 : 0);
    } else {
      lvl = levelAt.get(info.line) ?? 0;
      base = lvl;
      prevCode = { level: lvl, indent: info.indent };
    }
    for (const t of tokens) {
      if (OPENERS.has(t.type)) depth += 1;
      else if (CLOSERS.has(t.type)) depth -= 1;
    }

    // A table: adjacent non-continuation code lines that begin and end with `|`, aligned by column.
    if (!info.continuation && isTableRow(tokens)) {
      const rows: { info: LineInfo; tokens: Token[] }[] = [{ info, tokens }];
      let j = i + 1;
      while (j < lines.length && lines[j]!.kind === 'code' && !lines[j]!.continuation && levelAt.get(lines[j]!.line) === lvl && isTableRow(byLine.get(lines[j]!.line) ?? [])) {
        rows.push({ info: lines[j]!, tokens: byLine.get(lines[j]!.line)! });
        j += 1;
      }
      const cells = rows.map((r) => splitCells(r.tokens).map(joinTokens));
      const widths: number[] = [];
      for (const row of cells) row.forEach((c, k) => { widths[k] = Math.max(widths[k] ?? 0, c.length); });
      rows.forEach((r, k) => {
        const text = `| ${cells[k]!.map((c, col) => c.padEnd(widths[col]!)).join(' | ')} |`;
        emit(INDENT.repeat(lvl) + text + trailing(r.info));
      });
      i = j - 1;
      continue;
    }

    emit(INDENT.repeat(lvl) + joinTokens(tokens) + trailing(info));
  }

  const formatted = out.join('\n') + (out.length > 0 ? '\n' : '');
  return { formatted, ok: true };
}

function trailing(info: LineInfo): string {
  return info.comment === undefined ? '' : `  ${info.comment.trimEnd()}`;
}

function isTableRow(tokens: readonly Token[]): boolean {
  return tokens.length >= 2 && tokens[0]!.type === 'pipe' && tokens[tokens.length - 1]!.type === 'pipe';
}

function splitCells(tokens: readonly Token[]): Token[][] {
  const cells: Token[][] = [];
  let cur: Token[] = [];
  for (const t of tokens.slice(1, -1)) {
    if (t.type === 'pipe') { cells.push(cur); cur = []; } else cur.push(t);
  }
  cells.push(cur);
  return cells;
}

/** The tokens of one physical line, joined by `D995`'s spacing rules. */
export function joinTokens(tokens: readonly Token[]): string {
  // `{ IDENT }` is an interpolation and prints tight (FS-07's two-token rule); every other brace
  // pair is an object and prints padded, `{}` when empty.
  const interp = new Set<number>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i]!.type === 'lbrace' && tokens[i + 1]!.type === 'ident' && tokens[i + 2]!.type === 'rbrace') { interp.add(i); interp.add(i + 2); }
  }
  // `form a=1, b=2` writes its pairs tight; `let a = b` is spaced. Same token, one line-level fact.
  const formAt = tokens.findIndex((t) => t.type === 'ident' && t.value === 'form');
  let s = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (i > 0) s += separator(tokens[i - 1]!, t, i - 1, i, interp, formAt);
    s += t.raw;
  }
  return s;
}

function separator(a: Token, b: Token, ai: number, bi: number, interp: Set<number>, formAt: number): string {
  const adjacent = a.span.end.offset === b.span.start.offset;
  if (formAt !== -1 && ai > formAt && (a.type === 'equals' || b.type === 'equals')) return '';
  // Unary or binary is a parse fact: the space after `-`/`+` is kept as written.
  if (a.type === 'minus' || a.type === 'plus') return adjacent ? '' : ' ';
  // `4s` is a number and an ident, and the parser requires an abbreviated unit to touch its number
  // (`TF023`, D638) while `3 seconds` must not; the only other adjacency the parser reads.
  if (a.type === 'number' && b.type === 'ident') return adjacent ? '' : ' ';
  if (b.type === 'comma' || b.type === 'colon' || b.type === 'rparen' || b.type === 'rbracket' || b.type === 'dot' || b.type === 'percent') return '';
  if (a.type === 'lparen' || a.type === 'lbracket' || a.type === 'dot') return '';
  if (a.type === 'ident' && b.type === 'lparen') return ''; // `env(`, `unique(`
  // `body[0]` is an index and `equals [1, 2]` is a list: the same two tokens, told apart by the
  // parser — the third adjacency kept as written.
  if (a.type === 'ident' && b.type === 'lbracket') return adjacent ? '' : ' ';
  if (a.type === 'rbracket' && b.type === 'lbracket') return ''; // `body[0][1]`
  if (a.type === 'lbrace') return interp.has(ai) || b.type === 'rbrace' ? '' : ' ';
  if (b.type === 'rbrace') return interp.has(bi) ? '' : ' ';
  return ' ';
}

/**
 * The gate (`D997`): the same tokens in the same order with trivia excluded, every comment equal in
 * text and order, and a second pass changing nothing. Returns the problems, empty when it holds.
 */
export function roundTrip(source: string): string[] {
  const first = format(source);
  if (!first.ok) return [`not formatted: ${first.reason}`];
  const problems = compareTexts(source, first.formatted);
  const second = format(first.formatted);
  if (!second.ok) problems.push(`the formatted text does not format: ${second.reason}`);
  else if (second.formatted !== first.formatted) problems.push('not idempotent: a second pass changed the text');
  return problems;
}

/**
 * The comparison half of the gate, over any two texts: what `roundTrip` holds `format`'s output
 * to, exposed so a test can show each check fires on an output that fails it — the gate's own
 * vacuity control, since a round-trip that had stopped reading comments would pass a formatter
 * that deleted them.
 */
export function compareTexts(source: string, formatted: string): string[] {
  const problems: string[] = [];
  const before = lex(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  const after = lex(formatted);
  const sig = (r: LexResult) => r.tokens.filter((t) => t.type !== 'newline' && t.type !== 'indent' && t.type !== 'dedent' && t.type !== 'eof').map((t) => `${t.type}:${t.raw}`);
  const a = sig(before); const b = sig(after);
  if (a.length !== b.length) problems.push(`token count ${a.length} → ${b.length}`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) { problems.push(`token ${i} ${a[i]} → ${b[i]}`); break; }
  }
  const structure = (r: LexResult) => r.tokens.filter((t) => t.type === 'indent' || t.type === 'dedent').map((t) => t.type).join(',');
  if (structure(before) !== structure(after)) problems.push('the indent/dedent structure changed');
  const comments = (r: LexResult) => r.lines.filter((l) => l.comment !== undefined).map((l) => l.comment!.trimEnd());
  const ca = comments(before); const cb = comments(after);
  if (ca.length !== cb.length) problems.push(`comment count ${ca.length} → ${cb.length}`);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    if (ca[i] !== cb[i]) { problems.push(`comment ${i} changed: ${JSON.stringify(ca[i])} → ${JSON.stringify(cb[i])}`); break; }
  }
  return problems;
}
