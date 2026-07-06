// Hand-rolled lexer for the testFlow M0 surface (GRAMMAR.md § Lexical). Offside rule:
// significant indentation is turned into synthetic `indent`/`dedent`/`newline` tokens so the
// parser can stay indentation-agnostic. No parser generator (PLAN P#12) — we own the source
// positions and error recovery. Pure: input string in, tokens + diagnostics out. No I/O.

import type { Position, Span, Token, TokenType } from './token.js';
import { type Diagnostic, Codes } from './diagnostic.js';

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Characters that may appear in a `/`-initiated PATH token (GRAMMAR.md M0 simplification). */
const PATH_CHARS = /[A-Za-z0-9_\-./{}?=&:%~]/;

/** HTTP method words — a `/` right after one of these starts a PATH token; elsewhere `/` is the
 * arithmetic divide operator (M2, P#25). Case-insensitive to match the parser's method check. */
const METHOD_WORDS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}
function isIdentCont(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

class Lexer {
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  /** Indentation column stack; always begins with the base level 0. */
  private readonly indentStack: number[] = [0];
  /** The last token pushed (of any type) — used to decide whether `/` starts a PATH. */
  private lastMeaningful: Token | null = null;
  /** Open `{`/`[` count. While > 0, a physical line is a *continuation* of the same logical
   * line: its own indentation is irrelevant (no `indent`/`dedent`), and no `newline` is emitted
   * at its end — this is what lets an object/array literal span several hand-formatted lines. */
  private bracketDepth = 0;

  constructor(private readonly source: string) {}

  lex(): LexResult {
    const src = this.source;
    let lineStart = 0;
    let lineNo = 1;
    const n = src.length;

    let i = 0;
    while (i <= n) {
      // Find end of this physical line.
      let eol = src.indexOf('\n', i);
      const atEof = eol === -1;
      if (atEof) eol = n;
      const line = src.slice(lineStart, eol);

      this.processLine(line, lineStart, lineNo);

      if (atEof) break;
      lineStart = eol + 1;
      lineNo += 1;
      i = lineStart;
    }

    // Close any open indentation blocks, then EOF.
    const endPos = this.posAt(n, lineStart, lineNo);
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.push('dedent', '', '', { start: endPos, end: endPos });
    }
    this.push('eof', '', '', { start: endPos, end: endPos });

    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  // -- per-line handling -----------------------------------------------------

  private processLine(line: string, lineStart: number, lineNo: number): void {
    // Measure leading whitespace / indentation.
    let col = 0;
    let sawTab = false;
    while (col < line.length && (line[col] === ' ' || line[col] === '\t')) {
      if (line[col] === '\t') sawTab = true;
      col++;
    }
    const firstNonWs = col;

    // Blank or comment-only lines carry no structure.
    const rest = line.slice(firstNonWs);
    if (rest === '' || rest.startsWith('#')) return;

    if (sawTab) {
      const pos = this.posAt(lineStart, lineStart, lineNo);
      this.diag(Codes.INCONSISTENT_INDENT, 'error', 'tabs are not allowed in indentation; use spaces', {
        start: pos,
        end: this.posAt(lineStart + firstNonWs, lineStart, lineNo),
      });
    }

    // A line continuing an already-open `{`/`[` from a previous line carries no indentation
    // structure of its own (P#46 gap, found dogfooding restful-booker: a hand-formatted
    // multi-line `body { … }` must be usable, the way Python suppresses NEWLINE inside brackets).
    const continuingBracket = this.bracketDepth > 0;
    if (!continuingBracket) this.handleIndent(firstNonWs, lineStart, lineNo);
    this.lexContent(line, firstNonWs, lineStart, lineNo); // may open/close brackets, changing bracketDepth

    // Only a logical end-of-line — i.e. we're not left inside an open `{`/`[` — gets a `newline`.
    if (this.bracketDepth === 0) {
      const eolOffset = lineStart + line.length;
      const eolPos = this.posAt(eolOffset, lineStart, lineNo);
      this.push('newline', '', '', { start: eolPos, end: eolPos });
    }
  }

  private handleIndent(indentCol: number, lineStart: number, lineNo: number): void {
    const top = this.indentStack[this.indentStack.length - 1]!;
    const pos = this.posAt(lineStart + indentCol, lineStart, lineNo);
    const span: Span = { start: pos, end: pos };
    if (indentCol > top) {
      this.indentStack.push(indentCol);
      this.push('indent', '', '', span);
    } else if (indentCol < top) {
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1]! > indentCol) {
        this.indentStack.pop();
        this.push('dedent', '', '', span);
      }
      if (this.indentStack[this.indentStack.length - 1]! !== indentCol) {
        this.diag(
          Codes.INCONSISTENT_INDENT,
          'error',
          'indentation does not match any enclosing block',
          span,
          'each nested block must line up with its siblings',
        );
        // Recover: treat this level as the current one.
        this.indentStack.push(indentCol);
      }
    }
  }

  // -- inline token scanning -------------------------------------------------

  private lexContent(line: string, from: number, lineStart: number, lineNo: number): void {
    let c = from;
    const len = line.length;
    const at = (off: number): Position => this.posAt(lineStart + off, lineStart, lineNo);

    while (c < len) {
      const ch = line[c]!;

      if (ch === ' ' || ch === '\t') {
        c++;
        continue;
      }
      if (ch === '#') break; // trailing comment

      const startCol = c;
      const startPos = at(startCol);

      // string
      if (ch === '"') {
        c = this.lexString(line, c, lineStart, lineNo);
        continue;
      }

      // path (right after an HTTP method) vs. arithmetic divide (M2, P#25) — see METHOD_WORDS.
      if (ch === '/') {
        if (this.canStartPath()) {
          c++;
          while (c < len && PATH_CHARS.test(line[c]!)) c++;
          const raw = line.slice(startCol, c);
          this.push('path', raw, raw, { start: startPos, end: at(c) });
        } else {
          c++;
          this.push('slash', '/', '/', { start: startPos, end: at(c) });
        }
        continue;
      }

      // number
      if (isDigit(ch)) {
        c++;
        while (c < len && isDigit(line[c]!)) c++;
        if (c < len && line[c] === '.' && c + 1 < len && isDigit(line[c + 1]!)) {
          c++;
          while (c < len && isDigit(line[c]!)) c++;
        }
        const raw = line.slice(startCol, c);
        this.push('number', raw, raw, { start: startPos, end: at(c) });
        continue;
      }

      // tag
      if (ch === '@') {
        c++;
        const nameStart = c;
        while (c < len && isIdentCont(line[c]!)) c++;
        const name = line.slice(nameStart, c);
        const raw = line.slice(startCol, c);
        this.push('tag', name, raw, { start: startPos, end: at(c) });
        continue;
      }

      // identifier / keyword lexeme
      if (isIdentStart(ch)) {
        c++;
        while (c < len && isIdentCont(line[c]!)) c++;
        const raw = line.slice(startCol, c);
        this.push('ident', raw, raw, { start: startPos, end: at(c) });
        continue;
      }

      // punctuation
      const punct = PUNCT[ch];
      if (punct) {
        c++;
        this.push(punct, ch, ch, { start: startPos, end: at(c) });
        continue;
      }

      // anything else: report and skip one character (recovery).
      c++;
      this.diag(Codes.UNEXPECTED_CHAR, 'error', `unexpected character ${JSON.stringify(ch)}`, {
        start: startPos,
        end: at(c),
      });
    }
  }

  /** Lex a double-quoted string starting at `line[c] === '"'`. Returns the index past the string. */
  private lexString(line: string, c: number, lineStart: number, lineNo: number): number {
    const at = (off: number): Position => this.posAt(lineStart + off, lineStart, lineNo);
    const startCol = c;
    const startPos = at(startCol);
    const len = line.length;
    c++; // opening quote
    let value = '';
    let terminated = false;
    while (c < len) {
      const ch = line[c]!;
      if (ch === '"') {
        c++;
        terminated = true;
        break;
      }
      if (ch === '\\' && c + 1 < len) {
        const next = line[c + 1]!;
        value += ESCAPES[next] ?? next;
        c += 2;
        continue;
      }
      value += ch;
      c++;
    }
    const raw = line.slice(startCol, c);
    const span: Span = { start: startPos, end: at(c) };
    if (!terminated) {
      this.diag(Codes.UNTERMINATED_STRING, 'error', 'string literal is missing a closing quote', span);
    }
    this.push('string', value, raw, span);
    return c;
  }

  // -- helpers ---------------------------------------------------------------

  private posAt(offset: number, lineStart: number, lineNo: number): Position {
    return { offset, line: lineNo, column: offset - lineStart + 1 };
  }

  private canStartPath(): boolean {
    const t = this.lastMeaningful;
    if (!t || t.type !== 'ident' || !METHOD_WORDS.has(t.value.toUpperCase())) return false;
    // `t` must actually sit in HTTP-method position — right after the `api` keyword, optionally
    // with a named service in between (`api billing GET …`, `wait until api GET …`) — not just any
    // ident whose text happens to read like a method word (decision 60: `let ratio = get / 2` must
    // lex `/` as divide, not mistake a variable named `get` for `api GET`).
    const n = this.tokens.length;
    const prev = n >= 2 ? this.tokens[n - 2]! : null;
    if (prev && prev.type === 'ident' && prev.value === 'api') return true;
    const prevPrev = n >= 3 ? this.tokens[n - 3]! : null;
    return !!(prev && prev.type === 'ident' && prevPrev && prevPrev.type === 'ident' && prevPrev.value === 'api');
  }

  private push(type: TokenType, value: string, raw: string, span: Span): void {
    const tok: Token = { type, value, raw, span };
    this.tokens.push(tok);
    this.lastMeaningful = tok;
    if (type === 'lbrace' || type === 'lbracket') this.bracketDepth++;
    else if ((type === 'rbrace' || type === 'rbracket') && this.bracketDepth > 0) this.bracketDepth--;
  }

  private diag(code: string, severity: 'error' | 'warning', message: string, span: Span, hint?: string): void {
    this.diagnostics.push({ code, severity, message, span, ...(hint ? { hint } : {}) });
  }
}

const PUNCT: Record<string, TokenType | undefined> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  '(': 'lparen',
  ')': 'rparen',
  ':': 'colon',
  ',': 'comma',
  '.': 'dot',
  '=': 'equals',
  '+': 'plus',
  '-': 'minus',
  '*': 'star',
  '|': 'pipe',
};

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\',
};

export function lex(source: string): LexResult {
  return new Lexer(source).lex();
}
