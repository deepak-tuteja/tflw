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

/** Characters that may appear in a `/`-initiated PATH token.
 *
 * M59 (A1-06): this was the RFC-3986 *unreserved* set plus a handful of delimiters, which rejected
 * perfectly ordinary URLs — `?q=hello+world` and `?ids=1,2,3` both failed to lex, and the help line
 * said `expected end of line` without ever mentioning the path. It now covers every character RFC
 * 3986 permits unescaped in a path or query (unreserved + sub-delims + `[`/`]`/`@`), so a path stops
 * only at whitespace or a genuine comment.
 *
 * `#` is deliberately still excluded: it starts a comment, and no widening can change that without
 * making trailing comments unparseable after a path. The silent-truncation bug it used to cause
 * (A1-02 — a green run against a request the author never wrote) is handled at the scan site
 * instead, by diagnosing the collision rather than swallowing it. */
const PATH_CHARS = /[A-Za-z0-9_\-./{}?=&:%~!$'()*+,;[\]@]/;

/** A byte-order mark is invisible, so left as an "unexpected character" it produces a diagnostic
 * whose message quotes nothing a user can see (A1-04). Treated as whitespace wherever whitespace is
 * skipped; it is a zero-width no-break space, so this is harmless anywhere it appears. */
const BOM = '﻿';

/** Ceiling on "unexpected character" diagnostics from one lex (M59, A1-01) — see `unexpectedChars`.
 * Well past any real typo count, far below the point where rendering them costs anything. */
const MAX_UNEXPECTED_CHARS = 50;

/** HTTP method words — a `/` right after one of these starts a PATH token; elsewhere `/` is the
 * arithmetic divide operator (M2, P#25). Case-insensitive to match the parser's method check. */
const METHOD_WORDS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

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
  /** The `{`/`[` tokens opened and not yet closed. While non-empty, a physical line is a
   * *continuation* of the same logical line: its own indentation is irrelevant (no
   * `indent`/`dedent`), and no `newline` is emitted at its end — this is what lets an object/array
   * literal span several hand-formatted lines.
   *
   * M98b (`A1-10`, `A1-20`): this used to be a bare `number`. A count is enough to decide
   * *continuation*, and that is all it was ever asked, so a `{` that was never closed simply
   * swallowed the rest of the file and the lexer had nothing left to point at. Keeping the opening
   * tokens costs one array and makes `TF045` a lookup rather than an analysis. */
  private readonly openBrackets: Token[] = [];
  /** How many "unexpected character" diagnostics have been emitted (M59, A1-01). Recovery skips a
   * single character and reports it, so a file the lexer cannot read at all — a binary blob, a
   * minified bundle, the wrong file extension — produced one diagnostic *per byte*, each rendered
   * with a full copy of the offending line plus O(n) caret padding. That is quadratic: 50 KB of
   * unlexable input reached 3.6 GB and aborted the process. Past the cap the lexer keeps lexing
   * (recovery is unchanged) but stops accumulating, and says once that it has stopped. */
  private unexpectedChars = 0;

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
      // M59 (A1-03): drop a CRLF's `\r` before lexing. Nothing else in the toolchain normalizes
      // line endings, so without this a Windows-authored file produced one `TF001: unexpected
      // character "\r"` per line, each with the caret parked past the end of the visible text.
      // Only the *trailing* `\r` is removed, so every column on the line is unchanged.
      let line = src.slice(lineStart, eol);
      if (line.endsWith('\r')) line = line.slice(0, -1);

      this.processLine(line, lineStart, lineNo);

      if (atEof) break;
      lineStart = eol + 1;
      lineNo += 1;
      i = lineStart;
    }

    // M98b (`A1-10`, D154): anything still on the bracket stack at EOF was never closed. Report the
    // **innermost** one only: while a bracket is open the lexer emits no `newline`/`indent`/`dedent`
    // at all (see `processLine`), so a single stray `{` absorbs every line after it and the outer
    // entries are almost certainly consequences of the same typo — one diagnostic per nesting level
    // would be noise proportional to depth, all of it pointing at the same mistake.
    //
    // The caret used to land on a `dedent` synthesized at EOF: `printf 'test "x"\n  api POST /o body
    // {\n'` reported `TF010: expected a field name, found a dedent` at line 3 of a 2-line file,
    // underlining nothing. The opening bracket is the only position that names the actual mistake.
    const unclosed = this.openBrackets[this.openBrackets.length - 1];
    if (unclosed) {
      const closer = unclosed.value === '{' ? '}' : ']';
      this.diag(Codes.UNBALANCED_BRACKET, 'error', `this \`${unclosed.value}\` is never closed`, unclosed.span, `add the matching \`${closer}\`. While a \`{\` or \`[\` is open, tflw reads the following lines as a continuation of the same step rather than as steps of their own, so everything after this point was absorbed into it.`);
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
    while (col < line.length && (line[col] === ' ' || line[col] === '\t' || line[col] === BOM)) {
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
    const continuingBracket = this.openBrackets.length > 0;
    if (!continuingBracket) this.handleIndent(firstNonWs, lineStart, lineNo);
    this.lexContent(line, firstNonWs, lineStart, lineNo); // may open/close brackets

    // Only a logical end-of-line — i.e. we're not left inside an open `{`/`[` — gets a `newline`.
    if (this.openBrackets.length === 0) {
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

      if (ch === ' ' || ch === '\t' || ch === BOM) {
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
          // M59 (A1-02): `#` ends the path and starts a comment, so `/items?color=#fff&size=large`
          // used to shrink to `/items?color=` with *no* diagnostic anywhere — `tflw check` said "no
          // problems found", the run said `PASS`, and the request that left the machine was not the
          // one written. A silent wrong request is the one failure a testing tool must never
          // produce, so the collision is now reported at the point it happens.
          if (c < len && line[c] === '#') {
            this.diag(
              Codes.UNEXPECTED_CHAR,
              'error',
              `\`#\` ends the path \`${raw}\` and starts a comment`,
              { start: at(c), end: at(c + 1) },
              'write `%23` for a literal `#`. A URL fragment is never sent to the server, so it cannot be part of a request path.',
            );
          }
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
        this.checkNumberNotation(line, startCol, c, raw, at);
        continue;
      }

      // tag
      if (ch === '@') {
        c++;
        const nameStart = c;
        while (c < len && isIdentCont(line[c]!)) c++;
        const name = line.slice(nameStart, c);
        const raw = line.slice(startCol, c);
        // M98b (`A1-11`, D156): the push used to be unconditional, so `@` alone produced `tag:""`
        // and `tflw check` reported no problems. A tag that is not a writable name can never be
        // named in a `--tag` expression, so the test carrying it can be neither selected nor
        // excluded — silently. That is the failure class where a filter appears to work and runs the
        // wrong set, which is worse than a filter that errors.
        if (name === '' || !isIdentStart(name[0]!)) {
          // The `@ smoke` case — one stray space — is worth its own help line. Left to the parser it
          // becomes ``expected `test`, found `smoke``` with a caret on `smoke` and no mention of the
          // `@` at all; the lexer is the last layer that can still see the two together.
          const spaced = name === '' && /^[ \t]+[A-Za-z_]/.test(line.slice(c));
          this.diag(
            Codes.EMPTY_TAG,
            'error',
            name === '' ? 'a tag needs a name after the `@`' : `\`@${name}\` is not a usable tag name`,
            { start: startPos, end: at(c) },
            spaced
              ? 'delete the space — a tag is written `@smoke`, with the name attached to the `@`.'
              : 'a tag name starts with a letter or `_` and continues with letters, digits or `_`, so that `--tag` can name it.',
          );
        }
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
      this.unexpectedChars += 1;
      if (this.unexpectedChars < MAX_UNEXPECTED_CHARS) {
        this.diag(Codes.UNEXPECTED_CHAR, 'error', `unexpected character ${JSON.stringify(ch)}`, {
          start: startPos,
          end: at(c),
        });
      } else if (this.unexpectedChars === MAX_UNEXPECTED_CHARS) {
        this.diag(
          Codes.UNEXPECTED_CHAR,
          'error',
          `too many unreadable characters — stopping after ${MAX_UNEXPECTED_CHARS}`,
          { start: startPos, end: at(c) },
          'this usually means the file is not tflw source at all (a binary, a minified bundle, or the wrong extension), rather than that it has hundreds of separate typos.',
        );
      }
    }
  }

  /**
   * M98b (`A1-18`, D158): teach the numeric notations tflw does not have, at the number itself.
   *
   * `1e3` lexes as `number:"1"` + `ident:"e3"` and reached the author as ``TF010: unexpected `e3` at
   * end of step`` / `= help: expected end of line`. Diagnosed, so never silent — but this is the case
   * where the lexed reading (`1`) and the intended reading (`1000`) differ by 1000×, and the help
   * line pointed at the end of the line rather than at the number.
   *
   * **Deliberately narrow, and this is the whole design.** The obvious rule — "a `number` directly
   * followed by an ident-start character" — is wrong here, because that is exactly how every
   * *duration* in the language lexes: `pause 30s`, `timeout step 10s`, `expect duration is less than
   * 500ms` are all `number` + adjacent `ident`, and all legal. So the check fires only on the five
   * shapes that are unambiguously a foreign numeric notation and can never be a duration unit.
   *
   * **Recovery is unchanged**: the tokens are still `number` + `ident`, the parser behaves exactly as
   * before, and no golden moves except by gaining a better message. The code is `TF001` rather than a
   * fourth new one — this is "the lexer cannot read this" with a specific known cause, and §17's row
   * carries the cause.
   *
   * `.5` is **not** covered: `dot` + `number` is a legal pair in a path and in a field access, and
   * the lexer cannot tell `let a = .5` from a fragment of one without parser context.
   */
  private checkNumberNotation(line: string, startCol: number, numEnd: number, raw: string, at: (off: number) => Position): void {
    const len = line.length;
    let end = numEnd;
    while (end < len && (isIdentCont(line[end]!) || line[end] === '_')) end++;
    // An exponent's sign is not an ident character, so `1e-3` needs one extra look.
    if (end === numEnd + 1 && /[eE]/.test(line[numEnd] ?? '') && /[+-]/.test(line[end] ?? '')) {
      let signed = end + 1;
      while (signed < len && isDigit(line[signed]!)) signed++;
      if (signed > end + 1) end = signed;
    }
    if (end === numEnd) return;
    const suffix = line.slice(numEnd, end);

    let message: string | undefined;
    let value: number | undefined;
    if (/^[eE][+-]?\d+$/.test(suffix)) {
      message = 'exponent notation is not supported';
      value = Number(raw + suffix);
    } else if (raw === '0' && /^[xX][0-9a-fA-F]+$/.test(suffix)) {
      message = 'hexadecimal literals are not supported';
      value = Number('0' + suffix);
    } else if (raw === '0' && /^[bB][01]+$/.test(suffix)) {
      message = 'binary literals are not supported';
      value = Number('0' + suffix);
    } else if (raw === '0' && /^[oO][0-7]+$/.test(suffix)) {
      message = 'octal literals are not supported';
      value = Number('0' + suffix);
    } else if (/^_[\d_]*\d$/.test(suffix)) {
      message = 'digit separators are not supported';
      value = Number((raw + suffix).replace(/_/g, ''));
    }
    if (message === undefined) return;

    const written = value !== undefined && Number.isFinite(value) ? `write the value out: \`${value}\`.` : 'write the value out in plain decimal digits.';
    this.diag(Codes.UNEXPECTED_CHAR, 'error', `${message} — this reads as \`${raw}\` followed by the name \`${suffix}\``, { start: at(startCol), end: at(end) }, `tflw numbers are plain decimal digits with an optional \`.\` fraction; ${written}`);
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
        const decoded = ESCAPES[next];
        if (decoded === undefined) {
          this.diag(
            Codes.UNKNOWN_ESCAPE,
            'error',
            `unknown escape \`\\${next}\` in a string`,
            { start: at(c), end: at(c + 2) },
            `tflw strings support ${ESCAPE_LIST}. To put a backslash in the string itself — a regular expression, a Windows path — write it twice: \`matches "^\\\\d+$"\` hands the pattern \`^\\d+$\` to the engine.`,
          );
        }
        // Recovery is deliberately unchanged (the old `?? next`, i.e. drop the backslash). The value
        // is now attached to an *error*, so nothing runs with it; keeping the old behaviour means
        // this milestone changes exactly one thing — whether the fact is reported — and every token
        // golden stays put.
        value += decoded ?? next;
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
    if (type === 'lbrace' || type === 'lbracket') {
      this.openBrackets.push(tok);
    } else if (type === 'rbrace' || type === 'rbracket') {
      // M98b (`A1-20`): a closer at depth 0 used to be clamped out of the accounting and reported
      // nowhere. It is the same fact as an unclosed opener — bracket accounting does not balance —
      // seen from the other side, so it carries the same code (D155) rather than a second manifest
      // row saying the same thing about a case the parser also catches downstream.
      if (this.openBrackets.length > 0) this.openBrackets.pop();
      else {
        this.diag(
          Codes.UNBALANCED_BRACKET,
          'error',
          `\`${value}\` closes a bracket that was never opened`,
          span,
          `every \`${value}\` needs a matching \`${value === '}' ? '{' : '['}\` before it — either delete this one or add the opener it was meant to close.`,
        );
      }
    }
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
  '%': 'percent',
};

/** The complete set of string escapes. M98b (`A1-05`, D157): an escape *outside* this table is an
 * error (`TF047`), not a silently deleted backslash — `"^\d+$"` used to decode to `^d+$` and run
 * against a pattern nobody wrote.
 *
 * The alternative worth naming, because it is the tempting one: *preserve* the backslash, so `"\d"`
 * means `\d` and regexes just work. It is the one option that cannot be revised. Under it the
 * meaning of `"\q"` depends on whether `q` is in this table, so every escape added here later would
 * silently change the value of existing suites — while an error becoming legal is additive, which is
 * the only direction a frozen 1.0 surface can move. Erroring also matches JS, Java and non-raw
 * Python, which is what a `.tflw` author's fingers already know. */
const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\',
};

/** The supported escapes, rendered for `TF047`'s help line. Derived from `ESCAPES` rather than typed
 * out, so a sixth escape cannot ship with a help line that denies it exists — which is exactly the
 * drift GRAMMAR.md had already accumulated, listing four of these five. */
const ESCAPE_LIST = Object.keys(ESCAPES)
  .map((k) => `\`\\${k}\``)
  .join(', ')
  .replace(/, ([^,]*)$/, ' and $1');

export function lex(source: string): LexResult {
  return new Lexer(source).lex();
}
