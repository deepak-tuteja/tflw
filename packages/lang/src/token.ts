// Token definitions for the testFlow M0 lexer. See GRAMMAR.md § Lexical.

/**
 * A source location, in **UTF-16 code units** — the unit `String.prototype.slice` consumes and the
 * unit LSP 3.x requires.
 *
 * M98a (`A1-14`, `A1-OS-04`): this used to be documented as "a 0-based byte/char offset", and both
 * halves of that were wrong. `offset` is not a byte offset — for `  log "🚀" $` it reports 20 where
 * the UTF-8 byte offset is 22 — and `column` is not a count of characters, nor of the columns a
 * terminal would show. Nothing sliced a `Buffer` with it, so the cost was a wrong doc on a type
 * exported from `@tflw/lang` and frozen at 1.0, inviting the next consumer to corrupt every
 * non-ASCII source it touched.
 *
 * The unit is deliberately not changed: under an additive-only freeze, redefining a field's unit is
 * not an additive change. A *display* column — tabs expanded, CJK and emoji counted as two cells,
 * combining marks as none — is derived where it is needed, in `renderDiagnostic`'s `layoutLine`,
 * and exists nowhere else.
 */
export interface Position {
  /** 0-based UTF-16 code-unit offset into the source string. **Not** a byte offset. */
  readonly offset: number;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based UTF-16 code-unit column within the line. **Not** a display column — a tab counts 1
   * here and a CJK character counts 1; see `renderDiagnostic` for the terminal-cell coordinate. */
  readonly column: number;
}

/** Half-open source range `[start, end)`. `start`/`end` share a line for single-line tokens. */
export interface Span {
  readonly start: Position;
  readonly end: Position;
}

export type TokenType =
  // structural (offside rule)
  | 'newline'
  | 'indent'
  | 'dedent'
  | 'eof'
  // literals / names
  | 'ident'
  | 'string'
  | 'number'
  | 'path'
  | 'tag'
  // punctuation
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'lparen'
  | 'rparen'
  | 'colon'
  | 'comma'
  | 'dot'
  | 'equals' // the '=' sign (assignment), distinct from the `equals` matcher keyword
  | 'plus'
  | 'minus'
  | 'star'
  // '/' is context-sensitive: greedily a `path` right after an HTTP method, else arithmetic divide.
  | 'slash'
  // data-table row delimiter, `with each` (SPEC §4.3) — not used anywhere else in the grammar.
  | 'pipe'
  // `threshold error rate is less than 1%` (M29, perf arc D24a) — only meaningful directly after a
  // `number` token, never used anywhere else in the grammar.
  | 'percent';

export interface Token {
  readonly type: TokenType;
  /**
   * The lexeme as it appeared in source. For `string` tokens this is the *decoded* value
   * (quotes stripped, escapes applied); `raw` carries the original including quotes.
   * For `tag` tokens `value` is the name without the leading `@`.
   */
  readonly value: string;
  /** Original source text of the token (quotes/escapes intact). Equal to `value` when nothing is decoded. */
  readonly raw: string;
  readonly span: Span;
}

/** Human-readable description of a token type, for diagnostics ("expected `,`, found …").
 *
 * M98c (`A1-15`/`A1-OS-06`, D162): "human-readable" was true of twenty of the twenty-two outputs,
 * which is why the two that were not slipped through — `dedent` printed as "a dedent" and `indent`
 * as "indentation", both reaching users verbatim and one of them locked in by a checked-in golden.
 * `indent`/`dedent` are an implementation device (the offside rule, turned into synthetic tokens so
 * the parser can stay indentation-agnostic); a `.tflw` author has no concept named "dedent" and
 * nothing in SPEC.md or GRAMMAR.md introduces one. They are described here by the thing the author
 * *did* write: a block that starts, and a block that ends. */
export function describeTokenType(type: TokenType): string {
  switch (type) {
    case 'newline':
      return 'end of line';
    case 'indent':
      return 'an indented block';
    case 'dedent':
      return 'the end of the block';
    case 'eof':
      return 'end of file';
    case 'ident':
      return 'a name';
    case 'string':
      return 'a string';
    case 'number':
      return 'a number';
    case 'path':
      return 'a path';
    case 'tag':
      return 'a tag';
    case 'lbrace':
      return '`{`';
    case 'rbrace':
      return '`}`';
    case 'lbracket':
      return '`[`';
    case 'rbracket':
      return '`]`';
    case 'lparen':
      return '`(`';
    case 'rparen':
      return '`)`';
    case 'colon':
      return '`:`';
    case 'comma':
      return '`,`';
    case 'dot':
      return '`.`';
    case 'equals':
      return '`=`';
    case 'plus':
      return '`+`';
    case 'minus':
      return '`-`';
    case 'star':
      return '`*`';
    case 'slash':
      return '`/`';
    case 'pipe':
      return '`|`';
    case 'percent':
      return '`%`';
  }
}

/** A short quoted description of an actual token, for the "found …" half of an error. The
 * `indent`/`dedent` wording is D162's — see `describeTokenType`; both functions reach users and
 * fixing one would have left the other printing "a dedent". */
export function describeToken(tok: Token): string {
  switch (tok.type) {
    case 'newline':
      return 'end of line';
    case 'indent':
      return 'an indented block';
    case 'dedent':
      return 'the end of the block';
    case 'eof':
      return 'end of file';
    case 'string':
      return `string ${tok.raw}`;
    case 'path':
      return `path \`${tok.value}\``;
    case 'tag':
      return `tag \`@${tok.value}\``;
    default:
      return `\`${tok.value}\``;
  }
}
