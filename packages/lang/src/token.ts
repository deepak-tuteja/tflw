// Token definitions for the testFlow M0 lexer. See GRAMMAR.md § Lexical.

/** A 0-based byte/char offset into the source, plus 1-based line/column for humans. */
export interface Position {
  /** 0-based offset into the source string. */
  readonly offset: number;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column (character within the line). */
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
  | 'pipe';

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

/** Human-readable description of a token type, for diagnostics ("expected `,`, found …"). */
export function describeTokenType(type: TokenType): string {
  switch (type) {
    case 'newline':
      return 'end of line';
    case 'indent':
      return 'indentation';
    case 'dedent':
      return 'a dedent';
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
  }
}

/** A short quoted description of an actual token, for the "found …" half of an error. */
export function describeToken(tok: Token): string {
  switch (tok.type) {
    case 'newline':
      return 'end of line';
    case 'indent':
      return 'indentation';
    case 'dedent':
      return 'a dedent';
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
