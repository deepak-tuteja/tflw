// Recursive-descent parser for the testFlow M0 surface (GRAMMAR.md § Syntactic). Consumes the
// token stream from the lexer, produces a typed AST (ast.ts), and collects structured
// diagnostics with panic-mode recovery (skip to the next NEWLINE/DEDENT) so a single file can
// surface many errors. No parser generator (PLAN P#12); no I/O.

import type { Position, Span, Token } from './token.js';
import { describeToken, describeTokenType } from './token.js';
import { type Diagnostic, Codes, suggest } from './diagnostic.js';
import type {
  ActionDecl,
  ApiBody,
  ApiHeader,
  ApiRequestSpec,
  ApiServiceDecl,
  ArrayLit,
  BinaryExpr,
  BodySubject,
  BodyTextSubject,
  CallExpr,
  CaptureStmt,
  ConfigEntry,
  ConfigFile,
  DataTable,
  DateAtom,
  DateOffsetLit,
  DateOffsetUnit,
  DefaultsBlock,
  DurationLit,
  EnvBlock,
  EnvRef,
  ExpectStmt,
  Field,
  FieldValue,
  FileBody,
  FormatExpr,
  FormBody,
  FormField,
  GiveStmt,
  HeaderDecl,
  HeaderStmt,
  HookDecl,
  HttpMethod,
  ImportDecl,
  InlineBody,
  InsecureDecl,
  Interp,
  LetStmt,
  Matcher,
  MatcherName,
  NumberLit,
  ObjectLit,
  PathExpr,
  PathSegment,
  Program,
  RandomDateBetweenExpr,
  RandomDateInFutureExpr,
  RandomDateInPastExpr,
  RandomDecimalExpr,
  RandomLikeExpr,
  RandomNumberExpr,
  RandomOfExpr,
  RandomStringExpr,
  ReportDecl,
  RequireDecl,
  SessionDecl,
  Step,
  StringLit,
  StringPart,
  Subject,
  TestDecl,
  TextBody,
  TimeoutDecl,
  TimeoutTarget,
  UniqueEmailExpr,
  UniqueLikeExpr,
  UniqueNumberExpr,
  UniquePrefixExpr,
  UploadBody,
  UseDecl,
  Value,
  WaitUntilApiStmt,
  WebDecl,
  WorkersDecl,
} from './ast.js';

export interface ParseResult {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ConfigResult {
  readonly config: ConfigFile;
  readonly diagnostics: readonly Diagnostic[];
}

const STATEMENT_KEYWORDS = ['api', 'expect', 'check', 'let', 'capture', 'wait', 'give'] as const;
const SUBJECT_KEYWORDS = ['status', 'duration', 'header', 'body'] as const;
const MATCHER_KEYWORDS = ['equals', 'contains', 'matches', 'has', 'is', 'not'] as const;
const STATE_WORDS = ['visible', 'hidden', 'enabled', 'disabled', 'checked'] as const;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
const CONFIG_KEYS = ['header', 'timeout', 'workers', 'report', 'web', 'api', 'insecure'] as const;
const TIMEOUT_TARGETS = ['step', 'expect', 'wait'] as const;
const DURATION_UNITS = ['ms', 's', 'm'] as const;
const DATE_OFFSET_UNITS = ['seconds', 'minutes', 'hours', 'days', 'weeks'] as const;
const QUANTIFIERS = ['any', 'all'] as const;

class Parser {
  private pos = 0;
  private readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): ParseResult {
    const tests: TestDecl[] = [];
    const imports: ImportDecl[] = [];
    const uses: UseDecl[] = [];
    const actions: ActionDecl[] = [];
    const hooks: HookDecl[] = [];
    const startPos = this.peek().span.start;
    this.skipNewlines();
    while (!this.atEof()) {
      const before = this.pos;
      const tok = this.peek();
      if (this.check('tag') || this.isKw(tok, 'with') || this.isKw(tok, 'test')) {
        const test = this.parseTest();
        if (test) tests.push(test);
        else this.synchronize();
      } else if (this.isKw(tok, 'import')) {
        const imp = this.parseImportDecl();
        if (imp) imports.push(imp);
        else this.synchronize();
      } else if (this.isKw(tok, 'use')) {
        const u = this.parseUseDecl();
        if (u) uses.push(u);
        else this.synchronize();
      } else if (this.isKw(tok, 'action')) {
        const a = this.parseActionDecl();
        if (a) actions.push(a);
        else this.synchronize();
      } else if (this.isKw(tok, 'before') || this.isKw(tok, 'after')) {
        const h = this.parseHookDecl(tok.value as 'before' | 'after');
        if (h) hooks.push(h);
        else this.synchronize();
      } else {
        const hint = this.isKw(tok, 'tests') ? 'did you mean `test`?' : 'only `test`, `action`, `import`, `use`, `before`, or `after` declarations are allowed at the top level';
        this.error(Codes.UNEXPECTED_TOP_LEVEL, `expected a \`test\`, \`action\`, \`import\`, \`use\`, \`before\`, or \`after\`, found ${describeToken(tok)}`, tok.span, hint);
        this.synchronize();
      }
      // `synchronize()` deliberately won't cross a `dedent` (nested blocks consume their own), so
      // stray recovery landing exactly on one here — nothing left to close it — would otherwise
      // spin forever. Guarantee progress, same pattern as parseBlock/parseConfigEntries.
      if (this.pos === before) this.advance();
      this.skipNewlines();
    }
    const program: Program = { type: 'Program', imports, uses, actions, hooks, tests, span: this.spanFrom(startPos) };
    return { program, diagnostics: this.diagnostics };
  }

  // -- hooks (P#10, P#19) ------------------------------------------------------

  private parseHookDecl(when: 'before' | 'after'): HookDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `before` or `after`
    let scope: 'file' | 'each' = 'each';
    if (this.isKw(this.peek(), 'file')) {
      this.advance();
      scope = 'file';
    }
    this.endLine();
    const body = this.parseBlock(scope === 'file' ? `${when} file` : when);
    return { type: 'HookDecl', when, scope, body, span: this.spanFrom(start) };
  }

  // -- import / use / action (P#11, P#17) -------------------------------------

  private parseImportDecl(): ImportDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `import`
    const path = this.expectString('an import path string, e.g. `import "./shared/orders.tflw"`');
    if (!path) return null;
    this.endLine();
    return { type: 'ImportDecl', path, span: this.spanFrom(start) };
  }

  private parseUseDecl(): UseDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `use`
    const path = this.expectString('a helper module path string, e.g. `use "./helpers/sign.ts"`');
    if (!path) return null;
    this.endLine();
    return { type: 'UseDecl', path, span: this.spanFrom(start) };
  }

  private parseActionDecl(): ActionDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `action`
    const nameParts: string[] = [];
    while (this.check('ident')) {
      nameParts.push(this.advance().value);
      if (this.check('lparen')) break;
    }
    if (nameParts.length === 0) {
      this.error(Codes.UNEXPECTED_TOKEN, `expected an action name after \`action\`, found ${describeToken(this.peek())}`, this.peek().span);
      return null;
    }
    if (!this.expect('lparen', '`(` after the action name')) return null;
    const params: string[] = [];
    if (!this.check('rparen')) {
      for (;;) {
        const p = this.expect('ident', 'a parameter name');
        if (!p) return null;
        params.push(p.value);
        if (this.check('comma')) {
          this.advance();
          continue;
        }
        break;
      }
    }
    if (!this.expect('rparen', '`)` to close the parameter list')) return null;
    this.endLine();
    const body = this.parseBlock('action');
    return { type: 'ActionDecl', name: nameParts.join(' '), params, body, span: this.spanFrom(start) };
  }

  private parseGive(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `give`
    const value = this.parseValue();
    if (!value) return null;
    this.endLine();
    const stmt: GiveStmt = { type: 'GiveStmt', value, span: this.spanFrom(start) };
    return stmt;
  }

  // -- config dialect (tflw.config) ------------------------------------------

  parseConfig(): ConfigResult {
    const startPos = this.peek().span.start;
    let defaults: DefaultsBlock | null = null;
    const envs: EnvBlock[] = [];
    const requires: RequireDecl[] = [];
    const sessions: SessionDecl[] = [];
    this.skipNewlines();
    while (!this.atEof()) {
      const tok = this.peek();
      if (this.isKw(tok, 'defaults')) {
        const d = this.parseDefaultsBlock();
        if (d) {
          if (defaults) this.error(Codes.CONFIG_UNEXPECTED, 'duplicate `defaults` block', tok.span, 'a config has at most one `defaults` block');
          else defaults = d;
        }
      } else if (this.isKw(tok, 'env')) {
        const e = this.parseEnvBlock();
        if (e) envs.push(e);
        else this.synchronize();
      } else if (this.isKw(tok, 'require')) {
        const r = this.parseRequire();
        if (r) requires.push(r);
        else this.synchronize();
      } else if (this.isKw(tok, 'session')) {
        const s = this.parseSessionDecl();
        if (s) sessions.push(s);
        else this.synchronize();
      } else if (this.isKw(tok, 'test')) {
        this.error(Codes.CONFIG_TEST_NOT_ALLOWED, '`test` is not allowed in tflw.config', tok.span, 'the config dialect is declaration-only; put tests in `.tflw` files');
        this.synchronize();
        this.skipBlock();
      } else {
        this.error(
          Codes.CONFIG_UNEXPECTED,
          `expected \`defaults\`, \`env\`, \`session\`, or \`require\`, found ${describeToken(tok)}`,
          tok.span,
        );
        this.synchronize();
        this.skipBlock();
      }
      this.skipNewlines();
    }
    const config: ConfigFile = { type: 'ConfigFile', defaults, envs, requires, sessions, span: this.spanFrom(startPos) };
    return { config, diagnostics: this.diagnostics };
  }

  // -- session blocks (SPEC §3.3, P#20/31/42) --------------------------------

  private parseSessionDecl(): SessionDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `session`
    const name = this.expect('ident', 'a session name, e.g. `session admin`');
    if (!name) return null;
    this.endLine();
    const body = this.parseSessionBlock();
    return { type: 'SessionDecl', name: name.value, body, span: this.spanFrom(start) };
  }

  /** Like `parseBlock`, but also accepts a bare `header "…" is …` line (only valid inside a
   * session — SPEC §3.3). */
  private parseSessionBlock(): Step[] {
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `session` has no steps', this.peek().span, 'indent at least one step under the `session` line');
      return [];
    }
    this.advance(); // indent
    const steps: Step[] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const step = this.isKw(this.peek(), 'header') ? this.parseHeaderStmt() : this.parseStep();
      if (step) steps.push(step);
      else this.synchronize();
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    return steps;
  }

  private parseHeaderStmt(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `header`
    const name = this.expectString('a header name string, e.g. `header "Authorization"`');
    if (!name) return null;
    if (!this.expectKw('is')) return null;
    const value = this.parseValue();
    if (!value) return null;
    this.endLine();
    const stmt: HeaderStmt = { type: 'HeaderStmt', name, value, span: this.spanFrom(start) };
    return stmt;
  }

  private parseDefaultsBlock(): DefaultsBlock | null {
    const start = this.peek().span.start;
    this.advance(); // `defaults`
    this.endLine();
    const entries = this.parseConfigEntries();
    return { type: 'DefaultsBlock', entries, span: this.spanFrom(start) };
  }

  private parseEnvBlock(): EnvBlock | null {
    const start = this.peek().span.start;
    this.advance(); // `env`
    const name = this.expect('ident', 'an environment name, e.g. `env local`');
    if (!name) return null;
    let isDefault = false;
    if (this.isKw(this.peek(), 'default')) {
      this.advance();
      isDefault = true;
    }
    this.endLine();
    const entries = this.parseConfigEntries();
    return { type: 'EnvBlock', name: name.value, isDefault, entries, span: this.spanFrom(start) };
  }

  private parseConfigEntries(): ConfigEntry[] {
    const entries: ConfigEntry[] = [];
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this block has no entries', this.peek().span, 'indent at least one entry under the block header');
      return entries;
    }
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const parsed = this.parseConfigEntry();
      if (parsed) entries.push(...parsed);
      else this.synchronize();
      if (this.pos === before) this.advance();
    }
    if (this.check('dedent')) this.advance();
    return entries;
  }

  private parseConfigEntry(): ConfigEntry[] | null {
    const tok = this.peek();
    if (tok.type !== 'ident') {
      this.error(Codes.CONFIG_UNKNOWN_KEY, `expected a config key, found ${describeToken(tok)}`, tok.span);
      return null;
    }
    switch (tok.value) {
      case 'header':
        return this.wrap(this.parseHeaderDecl());
      case 'timeout':
        return this.parseTimeoutDecls();
      case 'workers':
        return this.wrap(this.parseWorkersDecl());
      case 'report':
        return this.wrap(this.parseReportDecl());
      case 'web':
        return this.wrap(this.parseWebDecl());
      case 'api':
        return this.wrap(this.parseApiServiceDecl());
      case 'insecure':
        return this.wrap(this.parseInsecureDecl());
      default: {
        const hint = suggest(tok.value, CONFIG_KEYS);
        this.error(
          Codes.CONFIG_UNKNOWN_KEY,
          `unknown config key \`${tok.value}\``,
          tok.span,
          hint ? `did you mean \`${hint}\`?` : `expected one of: ${CONFIG_KEYS.join(', ')}`,
        );
        return null;
      }
    }
  }

  private wrap(entry: ConfigEntry | null): ConfigEntry[] | null {
    return entry ? [entry] : null;
  }

  private parseHeaderDecl(): HeaderDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `header`
    const name = this.expectString('a header name string, e.g. `header "Accept"`');
    if (!name) return null;
    if (!this.expectKw('is')) return null;
    const value = this.parseValue();
    if (!value) return null;
    let service: string | null = null;
    if (this.isKw(this.peek(), 'for')) {
      this.advance();
      const s = this.expect('ident', 'a service name after `for`');
      if (s) service = s.value;
    }
    this.endLine();
    return { type: 'HeaderDecl', name, value, service, span: this.spanFrom(start) };
  }

  private parseTimeoutDecls(): ConfigEntry[] | null {
    this.advance(); // `timeout`
    const decls: TimeoutDecl[] = [];
    for (;;) {
      const start = this.peek().span.start;
      const targetTok = this.peek();
      if (targetTok.type !== 'ident' || !(TIMEOUT_TARGETS as readonly string[]).includes(targetTok.value)) {
        this.error(Codes.UNEXPECTED_TOKEN, `expected a timeout target (${TIMEOUT_TARGETS.join('/')}), found ${describeToken(targetTok)}`, targetTok.span);
        return decls.length ? decls : null;
      }
      this.advance();
      const ms = this.parseDuration();
      if (ms === null) return decls.length ? decls : null;
      decls.push({ type: 'TimeoutDecl', target: targetTok.value as TimeoutTarget, ms, span: this.spanFrom(start) });
      if (this.check('comma')) {
        this.advance();
        continue;
      }
      break;
    }
    this.endLine();
    return decls;
  }

  private parseDuration(): number | null {
    const num = this.expect('number', 'a duration, e.g. `10s` or `500ms`');
    if (!num) return null;
    const unitTok = this.peek();
    if (unitTok.type !== 'ident') {
      this.error(Codes.UNKNOWN_DURATION_UNIT, `expected a time unit (ms/s/m) after ${num.value}, found ${describeToken(unitTok)}`, unitTok.span);
      return null;
    }
    const n = Number(num.value);
    switch (unitTok.value) {
      case 'ms':
        this.advance();
        return n;
      case 's':
        this.advance();
        return n * 1000;
      case 'm':
        this.advance();
        return n * 60_000;
      default:
        this.error(Codes.UNKNOWN_DURATION_UNIT, `unknown time unit \`${unitTok.value}\``, unitTok.span, 'expected ms, s, or m');
        return null;
    }
  }

  private parseWorkersDecl(): WorkersDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `workers`
    const num = this.expect('number', 'a worker count, e.g. `workers 4`');
    if (!num) return null;
    this.endLine();
    return { type: 'WorkersDecl', count: Number(num.value), span: this.spanFrom(start) };
  }

  private parseInsecureDecl(): InsecureDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `insecure`
    const tok = this.peek();
    if (tok.type !== 'ident' || (tok.value !== 'true' && tok.value !== 'false')) {
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`true\` or \`false\` after \`insecure\`, found ${describeToken(tok)}`, tok.span);
      return null;
    }
    this.advance();
    this.endLine();
    return { type: 'InsecureDecl', value: tok.value === 'true', span: this.spanFrom(start) };
  }

  private parseReportDecl(): ReportDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `report`
    const dir = this.expectString('a report directory string, e.g. `report "./report"`');
    if (!dir) return null;
    this.endLine();
    return { type: 'ReportDecl', dir: dir.value, span: this.spanFrom(start) };
  }

  private parseWebDecl(): WebDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `web`
    const url = this.expectString('a base URL string, e.g. `web "http://localhost:5173"`');
    if (!url) return null;
    this.endLine();
    return { type: 'WebDecl', url, span: this.spanFrom(start) };
  }

  private parseApiServiceDecl(): ApiServiceDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `api`
    let service: string | null = null;
    if (this.check('ident')) service = this.advance().value; // named service before the URL
    const url = this.expectString('a base URL string, e.g. `api "http://localhost:3001"`');
    if (!url) return null;
    this.endLine();
    return { type: 'ApiServiceDecl', service, url, span: this.spanFrom(start) };
  }

  private parseRequire(): RequireDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `require`
    if (!this.expectKw('env')) return null;
    const names: string[] = [];
    const first = this.expect('ident', 'a variable name, e.g. `require env API_KEY`');
    if (!first) return null;
    names.push(first.value);
    while (this.check('comma')) {
      this.advance();
      const n = this.expect('ident', 'a variable name');
      if (n) names.push(n.value);
    }
    this.endLine();
    return { type: 'RequireDecl', names, span: this.spanFrom(start) };
  }

  /** Skip an indented block wholesale (recovery after a bad block header). */
  private skipBlock(): void {
    if (!this.check('indent')) return;
    let depth = 0;
    while (!this.atEof()) {
      const t = this.peek();
      if (t.type === 'indent') {
        depth++;
        this.advance();
      } else if (t.type === 'dedent') {
        depth--;
        this.advance();
        if (depth === 0) break;
      } else this.advance();
    }
  }

  // -- tests -----------------------------------------------------------------

  private parseTest(): TestDecl | null {
    const start = this.peek().span.start;
    const tags: string[] = [];
    // Tags may sit on their own line(s) above `test` (and above a `with each` table, if present).
    while (this.check('tag') || (this.check('newline') && tags.length > 0 && this.tagsContinue())) {
      if (this.check('tag')) tags.push(this.advance().value);
      else this.advance(); // newline between a tag line and the next tag/table/test line
    }
    let table: DataTable | null = null;
    if (this.isKw(this.peek(), 'with')) {
      table = this.parseDataTable();
    }
    if (!this.expectKw('test')) return null;
    const name = this.expectString('a test name string, e.g. `test "logs in"`');
    if (!name) return null;
    let session: string | null = null;
    if (this.isKw(this.peek(), 'as')) {
      this.advance();
      const s = this.expect('ident', 'a session name after `as`');
      if (s) session = s.value;
    }
    let retry = 0;
    if (this.isKw(this.peek(), 'retry')) {
      this.advance();
      const n = this.expect('number', 'a retry count, e.g. `retry 2`');
      if (n) retry = Number(n.value);
    }
    this.endLine();
    const body = this.parseBlock();
    return { type: 'TestDecl', name, tags, session, retry, table, body, span: this.spanFrom(start) };
  }

  private tagsContinue(): boolean {
    const next = this.peek(1);
    return next.type === 'tag' || this.isKw(next, 'with') || this.isKw(next, 'test');
  }

  // -- data tables (P#10, P#24) -------------------------------------------------

  private parseDataTable(): DataTable | null {
    const start = this.peek().span.start;
    this.advance(); // `with`
    if (!this.expectKw('each')) return null;
    if (this.isKw(this.peek(), 'from')) {
      this.advance();
      const path = this.expectString('a data file path, e.g. `with each from "./data/x.csv"`');
      if (!path) return null;
      this.endLine();
      return { type: 'FileDataTable', path, span: this.spanFrom(start) };
    }
    this.endLine();
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `with each` table has no rows', this.peek().span, 'indent a header row and at least one data row, e.g. `| col | … |`');
      return null;
    }
    this.advance(); // indent
    const columns = this.parseTableRow('a column name', () => this.parseTableColumnName());
    if (!columns) {
      this.synchronize();
      if (this.check('dedent')) this.advance();
      return null;
    }
    const rows: Value[][] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const row = this.parseTableRow('a cell value', () => this.parseValue());
      if (row) {
        if (row.length !== columns.length) {
          this.error(
            Codes.UNEXPECTED_TOKEN,
            `expected ${columns.length} cell(s) in this table row (matching the header), found ${row.length}`,
            this.spanFrom(before < this.tokens.length ? this.tokens[before]!.span.start : start),
          );
        } else {
          rows.push(row);
        }
      } else {
        this.synchronize();
      }
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    if (rows.length === 0) {
      this.error(Codes.EMPTY_BLOCK, 'this `with each` table has a header but no data rows', this.spanFrom(start), 'add at least one data row below the header, e.g. `| "value" |`');
    }
    return { type: 'InlineDataTable', columns, rows, span: this.spanFrom(start) };
  }

  private parseTableColumnName(): string | null {
    const tok = this.expect('ident', 'a column name');
    return tok ? tok.value : null;
  }

  /** One `| cell | cell | … |` line, generic over what a cell is (a column-name ident for the
   * header, a full `Value` expression for data rows). */
  private parseTableRow<T>(what: string, parseCell: () => T | null): T[] | null {
    if (!this.expect('pipe', '`|` to start the table row')) return null;
    const cells: T[] = [];
    while (!this.check('newline') && !this.check('dedent') && !this.atEof()) {
      const cell = parseCell();
      if (!cell) return null;
      cells.push(cell);
      if (!this.expect('pipe', `\`|\` after ${what}`)) return null;
    }
    this.endLine();
    return cells;
  }

  private parseBlock(context = 'test'): Step[] {
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, `this \`${context}\` has no steps`, this.peek().span, `indent at least one step under the \`${context}\` line`);
      return [];
    }
    this.advance(); // indent
    const steps: Step[] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const step = this.parseStep();
      if (step) steps.push(step);
      else this.synchronize();
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    return steps;
  }

  private parseStep(): Step | null {
    const tok = this.peek();
    if (tok.type === 'ident') {
      switch (tok.value) {
        case 'api':
          return this.parseApiStep();
        case 'expect':
          return this.parseExpect(false);
        case 'check':
          return this.parseExpect(true);
        case 'let':
          return this.parseLet();
        case 'capture':
          return this.parseCapture();
        case 'wait':
          return this.parseWaitUntilApi();
        case 'give':
          return this.parseGive();
        default: {
          const hint = suggest(tok.value, STATEMENT_KEYWORDS);
          this.error(
            Codes.UNKNOWN_STATEMENT,
            `unknown step \`${tok.value}\``,
            tok.span,
            hint ? `did you mean \`${hint}\`?` : `expected one of: ${STATEMENT_KEYWORDS.join(', ')}`,
            'not a known step keyword',
          );
          return null;
        }
      }
    }
    this.error(Codes.UNKNOWN_STATEMENT, `expected a step, found ${describeToken(tok)}`, tok.span);
    return null;
  }

  // -- api step --------------------------------------------------------------

  private parseApiStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `api`
    const spec = this.parseApiRequestLine();
    if (!spec) return null;
    this.endLine();
    const headers = this.parseApiHeaders();
    return { type: 'ApiStep', ...spec, headers: [...spec.headers, ...headers], span: this.spanFrom(start) };
  }

  /** The shared `[<service>] METHOD PATH [body-form] [timeout <dur>] [without redirects]` line,
   * used by both `api …` steps and `wait until api …` (SPEC §5.1, §5.5). Caller consumes `api`. */
  private parseApiRequestLine(): ApiRequestSpec | null {
    let service: string | null = null;
    let method: HttpMethod | null = null;

    const first = this.peek();
    if (first.type === 'ident' && this.isMethodWord(first)) {
      method = this.advance().value.toUpperCase() as HttpMethod;
    } else if (first.type === 'ident' && this.peek(1).type === 'ident' && this.isMethodWord(this.peek(1))) {
      service = this.advance().value; // service name
      method = this.advance().value.toUpperCase() as HttpMethod;
    } else {
      const hint = first.type === 'ident' ? suggest(first.value, METHODS as unknown as string[]) : undefined;
      this.error(
        Codes.UNKNOWN_METHOD,
        `expected an HTTP method (${METHODS.join(', ')}), found ${describeToken(first)}`,
        first.span,
        hint ? `did you mean \`${hint}\`?` : undefined,
      );
      return null;
    }

    const pathTok = this.peek();
    if (pathTok.type !== 'path') {
      this.error(Codes.UNEXPECTED_TOKEN, `expected a path like \`/orders\`, found ${describeToken(pathTok)}`, pathTok.span);
      return null;
    }
    this.advance();
    const path: PathExpr = { type: 'PathExpr', raw: pathTok.value, span: pathTok.span };

    let body: ApiBody | null = null;
    if (this.isKw(this.peek(), 'body') || this.isKw(this.peek(), 'form') || this.isKw(this.peek(), 'upload')) {
      body = this.parseApiBody();
      if (!body) return null;
    }

    let timeoutMs: number | null = null;
    if (this.isKw(this.peek(), 'timeout')) {
      this.advance();
      timeoutMs = this.parseDuration();
      if (timeoutMs === null) return null;
    }

    let followRedirects = true;
    if (this.isKw(this.peek(), 'without')) {
      this.advance();
      if (!this.expectKw('redirects')) return null;
      followRedirects = false;
    }

    return { service, method: method!, path, body, headers: [], timeoutMs, followRedirects };
  }

  private parseApiBody(): ApiBody | null {
    const tok = this.peek();
    if (this.isKw(tok, 'form')) return this.parseFormBody();
    if (this.isKw(tok, 'upload')) return this.parseUploadBody();
    // `body …` — dispatch on what follows `body`.
    const start = tok.span.start;
    this.advance(); // `body`
    if (this.isKw(this.peek(), 'from')) {
      this.advance();
      const path = this.expectString('a file path string, e.g. `body from "./payloads/order.json"`');
      if (!path) return null;
      return { type: 'FileBody', path, span: this.spanFrom(start) };
    }
    if (this.isKw(this.peek(), 'text')) {
      this.advance();
      const value = this.expectString('a raw payload string, e.g. `body text "plain payload"`');
      if (!value) return null;
      return { type: 'TextBody', value, span: this.spanFrom(start) };
    }
    const object = this.parseObject();
    if (!object) return null;
    return { type: 'InlineBody', object, span: this.spanFrom(start) };
  }

  private parseFormBody(): FormBody | null {
    const start = this.peek().span.start;
    this.advance(); // `form`
    const fields = this.parseFormFields();
    if (!fields) return null;
    return { type: 'FormBody', fields, span: this.spanFrom(start) };
  }

  private parseUploadBody(): UploadBody | null {
    const start = this.peek().span.start;
    this.advance(); // `upload`
    const filePath = this.expectString('a file path string, e.g. `upload "./files/img.png" as "avatar"`');
    if (!filePath) return null;
    if (!this.expectKw('as')) return null;
    const fieldName = this.expectString('a field name string after `as`');
    if (!fieldName) return null;
    let extra: FormField[] = [];
    if (this.isKw(this.peek(), 'form')) {
      this.advance();
      const fields = this.parseFormFields();
      if (!fields) return null;
      extra = fields;
    }
    return { type: 'UploadBody', filePath, fieldName, extra, span: this.spanFrom(start) };
  }

  private parseFormFields(): FormField[] | null {
    const fields: FormField[] = [];
    for (;;) {
      const start = this.peek().span.start;
      const key = this.expect('ident', 'a field name, e.g. `form user=…`');
      if (!key) return null;
      if (!this.expect('equals', '`=` after the field name')) return null;
      const value = this.parseValue();
      if (!value) return null;
      fields.push({ type: 'FormField', key: key.value, value, span: this.spanFrom(start) });
      if (this.check('comma')) {
        this.advance();
        continue;
      }
      break;
    }
    return fields;
  }

  /** An optional indented block of `header "…" is <value>` lines beneath an api step (SPEC §5.1). */
  private parseApiHeaders(): ApiHeader[] {
    const headers: ApiHeader[] = [];
    if (!this.check('indent')) return headers;
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      if (this.isKw(this.peek(), 'header')) {
        const start = this.peek().span.start;
        this.advance(); // `header`
        const name = this.expectString('a header name string, e.g. `header "Authorization"`');
        if (name && this.expectKw('is')) {
          const value = this.parseValue();
          if (value) {
            this.endLine();
            headers.push({ type: 'ApiHeader', name, value, span: this.spanFrom(start) });
          } else this.synchronize();
        } else this.synchronize();
      } else {
        this.error(Codes.UNEXPECTED_TOKEN, `only \`header\` lines may follow an api step, found ${describeToken(this.peek())}`, this.peek().span);
        this.synchronize();
      }
      if (this.pos === before) this.advance();
    }
    if (this.check('dedent')) this.advance();
    return headers;
  }

  // -- wait until api ---------------------------------------------------------

  /** `wait until api …` re-issues the request until its nested `expect`s pass or wait times out
   * (SPEC §5.5, P#15). Caller has not yet consumed `wait`. */
  private parseWaitUntilApi(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `wait`
    if (!this.expectKw('until')) return null;
    if (!this.expectKw('api')) return null;
    const request = this.parseApiRequestLine();
    if (!request) return null;
    this.endLine();
    const expects = this.parseExpectOnlyBlock();
    return { type: 'WaitUntilApiStmt', request, expects, span: this.spanFrom(start) };
  }

  /** An indented block containing only `expect` lines (the body of `wait until api`). */
  private parseExpectOnlyBlock(): ExpectStmt[] {
    const expects: ExpectStmt[] = [];
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `wait until` has no `expect` lines', this.peek().span, 'indent at least one `expect` under the request line');
      return expects;
    }
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      if (this.isKw(this.peek(), 'expect')) {
        const stmt = this.parseExpect(false);
        if (stmt) expects.push(stmt as ExpectStmt);
        else this.synchronize();
      } else {
        this.error(Codes.UNEXPECTED_TOKEN, `only \`expect\` lines may follow \`wait until api\`, found ${describeToken(this.peek())}`, this.peek().span);
        this.synchronize();
      }
      if (this.pos === before) this.advance();
    }
    if (this.check('dedent')) this.advance();
    return expects;
  }

  private parseEnvRef(): EnvRef | null {
    const start = this.peek().span.start;
    this.advance(); // `env`
    if (!this.expect('lparen', '`(` after `env`')) return null;
    const name = this.expect('ident', 'an environment variable name, e.g. `env(API_KEY)`');
    if (!name) return null;
    if (!this.expect('rparen', '`)` to close `env(…)`')) return null;
    return { type: 'EnvRef', name: name.value, span: this.spanFrom(start) };
  }

  // -- expect ----------------------------------------------------------------

  private parseExpect(soft: boolean): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `expect` or `check`
    let quantifier: 'any' | 'all' | null = null;
    const lead = this.peek();
    if (lead.type === 'ident' && (QUANTIFIERS as readonly string[]).includes(lead.value)) {
      quantifier = this.advance().value as 'any' | 'all';
    }
    const subject = this.parseSubject();
    if (!subject) return null;
    if (quantifier && subject.type !== 'BodySubject') {
      this.error(Codes.UNEXPECTED_TOKEN, `\`${quantifier}\` only applies to a \`body.<path>\` subject`, subject.span, 'drop the quantifier, or use a body path (SPEC §6.3)');
      return null;
    }
    const matcher = this.parseMatcher();
    if (!matcher) return null;
    this.endLine();
    const stmt: ExpectStmt = { type: 'ExpectStmt', soft, quantifier, subject, matcher, span: this.spanFrom(start) };
    return stmt;
  }

  private parseSubject(): Subject | null {
    const tok = this.peek();
    if (tok.type !== 'ident') {
      this.error(Codes.UNKNOWN_SUBJECT, `expected a subject (${SUBJECT_KEYWORDS.join(', ')}), found ${describeToken(tok)}`, tok.span);
      return null;
    }
    const start = tok.span.start;
    switch (tok.value) {
      case 'status':
        this.advance();
        return { type: 'StatusSubject', span: this.spanFrom(start) };
      case 'duration':
        this.advance();
        return { type: 'DurationSubject', span: this.spanFrom(start) };
      case 'header': {
        this.advance();
        const name = this.expectString('a header name string, e.g. `header "content-type"`');
        if (!name) return null;
        return { type: 'HeaderSubject', name, span: this.spanFrom(start) };
      }
      case 'body': {
        this.advance();
        if (this.isKw(this.peek(), 'text')) {
          this.advance();
          const subj: BodyTextSubject = { type: 'BodyTextSubject', span: this.spanFrom(start) };
          return subj;
        }
        const path = this.parseBodyPath();
        const subj: BodySubject = { type: 'BodySubject', path, span: this.spanFrom(start) };
        return subj;
      }
      default: {
        const hint = suggest(tok.value, SUBJECT_KEYWORDS);
        this.error(
          Codes.UNKNOWN_SUBJECT,
          `unknown subject \`${tok.value}\``,
          tok.span,
          hint ? `did you mean \`${hint}\`?` : `expected one of: ${SUBJECT_KEYWORDS.join(', ')}`,
        );
        return null;
      }
    }
  }

  private parseBodyPath(): PathSegment[] {
    const segs: PathSegment[] = [];
    while (this.check('dot') || this.check('lbracket')) {
      if (this.check('dot')) {
        this.advance();
        const name = this.expect('ident', 'a property name after `.`');
        if (!name) break;
        segs.push({ kind: 'prop', name: name.value });
      } else {
        this.advance(); // [
        const idx = this.expect('number', 'an array index');
        let index = 0;
        if (idx) index = Number(idx.value);
        this.expect('rbracket', '`]` to close the index');
        segs.push({ kind: 'index', index });
      }
    }
    return segs;
  }

  private parseMatcher(): Matcher | null {
    const start = this.peek().span.start;
    let negated = false;
    if (this.isKw(this.peek(), 'not')) {
      this.advance();
      negated = true;
    }
    const tok = this.peek();
    if (tok.type !== 'ident') {
      this.error(Codes.UNKNOWN_MATCHER, `expected a matcher, found ${describeToken(tok)}`, tok.span);
      return null;
    }
    const mk = (name: MatcherName, value: Value | null): Matcher => ({ type: 'Matcher', name, negated, value, span: this.spanFrom(start) });

    switch (tok.value) {
      case 'equals': {
        this.advance();
        const v = this.parseValue();
        return v ? mk('equals', v) : null;
      }
      case 'contains': {
        this.advance();
        const v = this.parseValue();
        return v ? mk('contains', v) : null;
      }
      case 'matches': {
        this.advance();
        const v = this.expectString('a regex string, e.g. `matches "json"`');
        return v ? mk('matches', v) : null;
      }
      case 'has': {
        this.advance();
        const next = this.peek();
        if (this.isKw(next, 'count')) {
          this.advance();
          const num = this.expect('number', 'a count, e.g. `has count 3`');
          if (!num) return null;
          const value: NumberLit = { type: 'NumberLit', value: Number(num.value), raw: num.raw, span: num.span };
          return mk('hasCount', value);
        }
        if (this.isKw(next, 'value')) {
          this.advance();
          const v = this.parseValue();
          return v ? mk('hasValue', v) : null;
        }
        this.error(Codes.UNKNOWN_MATCHER, `expected \`count\` or \`value\` after \`has\`, found ${describeToken(next)}`, next.span);
        return null;
      }
      case 'is': {
        this.advance();
        const next = this.peek();
        if (this.isKw(next, 'greater')) {
          this.advance();
          if (!this.expectKw('than')) return null;
          const v = this.parseValue();
          return v ? mk('greaterThan', v) : null;
        }
        if (this.isKw(next, 'less')) {
          this.advance();
          if (!this.expectKw('than')) return null;
          const v = this.parseValue();
          return v ? mk('lessThan', v) : null;
        }
        if (next.type === 'ident' && (STATE_WORDS as readonly string[]).includes(next.value)) {
          this.advance();
          return mk(next.value as MatcherName, null);
        }
        const hint = next.type === 'ident' ? suggest(next.value, ['greater', 'less', ...STATE_WORDS]) : undefined;
        this.error(
          Codes.UNKNOWN_MATCHER,
          `unexpected ${describeToken(next)} after \`is\``,
          next.span,
          hint ? `did you mean \`${hint}\`?` : 'expected `greater than`, `less than`, or a state (visible/hidden/enabled/disabled/checked)',
        );
        return null;
      }
      default: {
        const hint = suggest(tok.value, MATCHER_KEYWORDS);
        this.error(
          Codes.UNKNOWN_MATCHER,
          `unknown matcher \`${tok.value}\``,
          tok.span,
          hint ? `did you mean \`${hint}\`?` : `expected one of: equals, contains, matches, is …, has …`,
        );
        return null;
      }
    }
  }

  // -- let / capture ---------------------------------------------------------

  private parseLet(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `let`
    const name = this.expect('ident', 'a variable name after `let`');
    if (!name) return null;
    if (!this.expect('equals', '`=` after the variable name')) return null;
    const value = this.parseValue();
    if (!value) return null;
    this.endLine();
    const stmt: LetStmt = { type: 'LetStmt', name: name.value, value, span: this.spanFrom(start) };
    return stmt;
  }

  private parseCapture(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `capture`
    const subject = this.parseSubject();
    if (!subject) return null;
    if (!this.expectKw('as')) return null;
    const name = this.expect('ident', 'a variable name after `as`');
    if (!name) return null;
    this.endLine();
    const stmt: CaptureStmt = { type: 'CaptureStmt', subject, name: name.value, span: this.spanFrom(start) };
    return stmt;
  }

  // -- values: arithmetic + date-math expressions (P#25) ----------------------
  //
  // `parseValue` is the public entry point (kept as the name every call site already uses); it
  // climbs two precedence levels (`+ - ` then `* /`) down to `parseAtom`, the leaf dispatch that
  // used to be all there was in M0/M1. No parens — the closed grammar has none (P#25).

  private parseValue(): Value | null {
    return this.parseAddSub();
  }

  private parseAddSub(): Value | null {
    let left = this.parseMulDiv();
    if (!left) return null;
    for (;;) {
      const tok = this.peek();
      if (tok.type !== 'plus' && tok.type !== 'minus') break;
      this.advance();
      const right = this.parseMulDiv();
      if (!right) return null;
      left = { type: 'BinaryExpr', op: tok.type === 'plus' ? '+' : '-', left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  private parseMulDiv(): Value | null {
    let left = this.parseAtom();
    if (!left) return null;
    for (;;) {
      const tok = this.peek();
      if (tok.type !== 'star' && tok.type !== 'slash') break;
      this.advance();
      const right = this.parseAtom();
      if (!right) return null;
      left = { type: 'BinaryExpr', op: tok.type === 'star' ? '*' : '/', left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  /** Leaf value: string, number/duration/date-offset, bool, null, `{interp}`, a bare identifier
   * reference, `env(…)`, `today`/`now`, `format …`, or a `unique`/`random` generator. */
  private parseAtom(): Value | null {
    const tok = this.peek();
    if (tok.type === 'minus') {
      // Unary minus is sugar for `0 - operand` — the operand can be anything that might evaluate
      // to a number at runtime (a literal, `{var}`, a generator, …); whether it actually does is a
      // runtime type check like every other arithmetic mismatch (P#25), not a parse-time one.
      this.advance();
      const operand = this.parseAtom();
      if (!operand) return null;
      const zero: NumberLit = { type: 'NumberLit', value: 0, raw: '0', span: tok.span };
      const expr: BinaryExpr = { type: 'BinaryExpr', op: '-', left: zero, right: operand, span: { start: tok.span.start, end: operand.span.end } };
      return expr;
    }
    switch (tok.type) {
      case 'string':
        this.advance();
        return this.makeStringLit(tok);
      case 'number': {
        this.advance();
        // A number immediately (no whitespace) followed by a short time unit is a duration
        // literal, e.g. `500ms` in `expect duration is less than 500ms` (SPEC §5.3).
        const unitTok = this.peek();
        if (unitTok.type === 'ident' && unitTok.span.start.offset === tok.span.end.offset && (DURATION_UNITS as readonly string[]).includes(unitTok.value)) {
          this.advance();
          const ms = toMs(Number(tok.value), unitTok.value as (typeof DURATION_UNITS)[number]);
          const lit: DurationLit = { type: 'DurationLit', ms, span: { start: tok.span.start, end: unitTok.span.end } };
          return lit;
        }
        // A number followed (whitespace allowed) by a spelled-out unit is a date offset, e.g.
        // `3 days` in `today + 3 days` (P#25) — distinct word set from the duration units above.
        if (unitTok.type === 'ident' && (DATE_OFFSET_UNITS as readonly string[]).includes(unitTok.value)) {
          this.advance();
          const lit: DateOffsetLit = { type: 'DateOffsetLit', amount: Number(tok.value), unit: unitTok.value as DateOffsetUnit, span: { start: tok.span.start, end: unitTok.span.end } };
          return lit;
        }
        return { type: 'NumberLit', value: Number(tok.value), raw: tok.raw, span: tok.span };
      }
      case 'lbrace':
        return this.parseInterp();
      case 'ident': {
        if (tok.value === 'env' && this.peek(1).type === 'lparen') return this.parseEnvRef();
        if (tok.value === 'unique') return this.parseUniqueExpr();
        if (tok.value === 'random') return this.parseRandomExpr();
        if (tok.value === 'format') return this.parseFormatExpr();
        if (tok.value === 'today' || tok.value === 'now') {
          this.advance();
          const atom: DateAtom = { type: 'DateAtom', which: tok.value, span: tok.span };
          return atom;
        }
        if (tok.value === 'true' || tok.value === 'false') {
          this.advance();
          return { type: 'BoolLit', value: tok.value === 'true', span: tok.span };
        }
        if (tok.value === 'null') {
          this.advance();
          return { type: 'NullLit', span: tok.span };
        }
        return this.parseIdentOrCall(tok);
      }
      default:
        this.error(Codes.UNEXPECTED_TOKEN, `expected a value, found ${describeToken(tok)}`, tok.span);
        return null;
    }
  }

  /** A bare variable reference (`orderId`) or a call to an action/JS-helper (`create order(...)`,
   * `sign payload(...)`) — disambiguated by lookahead: variables are never multi-word in this
   * grammar, so any run of 2+ idents must be heading for `(` (P#11, P#17). Called with the first
   * ident already peeked (not yet consumed). */
  private parseIdentOrCall(first: Token): Value | null {
    let k = 1;
    while (this.peek(k).type === 'ident') k++;
    if (this.peek(k).type === 'lparen') {
      const start = first.span.start;
      const nameParts: string[] = [];
      for (let i = 0; i < k; i++) nameParts.push(this.advance().value);
      this.advance(); // lparen
      const args: Value[] = [];
      if (!this.check('rparen')) {
        for (;;) {
          const arg = this.parseValue();
          if (!arg) return null;
          args.push(arg);
          if (this.check('comma')) {
            this.advance();
            continue;
          }
          break;
        }
      }
      if (!this.expect('rparen', '`)` to close the call')) return null;
      const expr: CallExpr = { type: 'CallExpr', name: nameParts.join(' '), args, span: this.spanFrom(start) };
      return expr;
    }
    if (k > 1) {
      this.advance(); // consume just the first ident so recovery makes progress
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `\`${first.value}\` looks like the start of a call but never reaches \`(\``,
        first.span,
        'multi-word calls need parens, e.g. `create order(...)`',
      );
      return null;
    }
    this.advance();
    return { type: 'VarRef', name: first.value, span: first.span };
  }

  // -- generators: unique / random (P#19, P#21–23) ----------------------------

  private parseUniqueExpr(): Value | null {
    const start = this.peek().span.start;
    this.advance(); // `unique`
    if (this.check('lparen')) {
      this.advance();
      const prefix = this.parseValue();
      if (!prefix) return null;
      if (!this.expect('rparen', '`)` to close `unique(…)`')) return null;
      const expr: UniquePrefixExpr = { type: 'UniquePrefixExpr', prefix, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(this.peek(), 'email')) {
      this.advance();
      const expr: UniqueEmailExpr = { type: 'UniqueEmailExpr', span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(this.peek(), 'number')) {
      this.advance();
      const expr: UniqueNumberExpr = { type: 'UniqueNumberExpr', span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(this.peek(), 'like')) {
      this.advance();
      const pattern = this.expectString('a like-pattern string, e.g. `unique like "ORD-######"`');
      if (!pattern) return null;
      const expr: UniqueLikeExpr = { type: 'UniqueLikeExpr', pattern, span: this.spanFrom(start) };
      return expr;
    }
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `expected \`(…)\`, \`email\`, \`number\`, or \`like\` after \`unique\`, found ${describeToken(tok)}`, tok.span);
    return null;
  }

  private parseRandomExpr(): Value | null {
    const start = this.peek().span.start;
    this.advance(); // `random`
    const tok = this.peek();
    if (this.isKw(tok, 'number')) {
      this.advance();
      const from = this.parseValue();
      if (!from) return null;
      if (!this.expectKw('to')) return null;
      const to = this.parseValue();
      if (!to) return null;
      const expr: RandomNumberExpr = { type: 'RandomNumberExpr', from, to, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'decimal')) {
      this.advance();
      const from = this.parseValue();
      if (!from) return null;
      if (!this.expectKw('to')) return null;
      const to = this.parseValue();
      if (!to) return null;
      const expr: RandomDecimalExpr = { type: 'RandomDecimalExpr', from, to, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'date')) {
      this.advance();
      if (this.isKw(this.peek(), 'in')) {
        this.advance();
        if (this.isKw(this.peek(), 'past')) {
          this.advance();
          const expr: RandomDateInPastExpr = { type: 'RandomDateInPastExpr', span: this.spanFrom(start) };
          return expr;
        }
        if (this.isKw(this.peek(), 'future')) {
          this.advance();
          const expr: RandomDateInFutureExpr = { type: 'RandomDateInFutureExpr', span: this.spanFrom(start) };
          return expr;
        }
        const t = this.peek();
        this.error(Codes.UNEXPECTED_TOKEN, `expected \`past\` or \`future\` after \`random date in\`, found ${describeToken(t)}`, t.span);
        return null;
      }
      if (this.isKw(this.peek(), 'between')) {
        this.advance();
        const from = this.parseValue();
        if (!from) return null;
        if (!this.expectKw('and')) return null;
        const to = this.parseValue();
        if (!to) return null;
        const expr: RandomDateBetweenExpr = { type: 'RandomDateBetweenExpr', from, to, span: this.spanFrom(start) };
        return expr;
      }
      const t = this.peek();
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`in\` or \`between\` after \`random date\`, found ${describeToken(t)}`, t.span);
      return null;
    }
    if (this.isKw(tok, 'of')) {
      this.advance();
      const choices: Value[] = [];
      const first = this.parseValue();
      if (!first) return null;
      choices.push(first);
      while (this.check('comma')) {
        this.advance();
        const v = this.parseValue();
        if (!v) return null;
        choices.push(v);
      }
      const expr: RandomOfExpr = { type: 'RandomOfExpr', choices, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'string')) {
      this.advance();
      const length = this.parseValue();
      if (!length) return null;
      const expr: RandomStringExpr = { type: 'RandomStringExpr', length, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'like')) {
      this.advance();
      const pattern = this.expectString('a like-pattern string, e.g. `random like "SKU-####-??"`');
      if (!pattern) return null;
      const expr: RandomLikeExpr = { type: 'RandomLikeExpr', pattern, span: this.spanFrom(start) };
      return expr;
    }
    this.error(
      Codes.UNEXPECTED_TOKEN,
      `expected \`number\`, \`decimal\`, \`date\`, \`of\`, \`string\`, or \`like\` after \`random\`, found ${describeToken(tok)}`,
      tok.span,
    );
    return null;
  }

  private parseFormatExpr(): Value | null {
    const start = this.peek().span.start;
    this.advance(); // `format`
    const value = this.parseValue();
    if (!value) return null;
    if (!this.expectKw('as')) return null;
    const pattern = this.expectString('a format pattern string, e.g. `format {d} as "yyyy-MM-dd"`');
    if (!pattern) return null;
    const expr: FormatExpr = { type: 'FormatExpr', value, pattern, span: this.spanFrom(start) };
    return expr;
  }

  /** Field value: any scalar value, plus nested objects and arrays (JSON body shapes). */
  private parseFieldValue(): FieldValue | null {
    const tok = this.peek();
    if (tok.type === 'lbracket') return this.parseArray();
    // Disambiguate `{ key: … }` (object) from a `{ref}`-led *expression* (`{price} * 2`, P#25):
    // only an unambiguous object shape short-circuits here. Everything else — including a bare
    // `{ref}` — falls through to `parseValue()`, whose `parseAtom` already treats `{` as an
    // interpolation atom and, critically, keeps climbing for a trailing `* / + -`.
    if (
      tok.type === 'lbrace' &&
      (this.peek(1).type === 'rbrace' ||
        ((this.peek(1).type === 'ident' || this.peek(1).type === 'string') && this.peek(2).type === 'colon'))
    ) {
      return this.parseObject();
    }
    return this.parseValue();
  }

  private parseObject(): ObjectLit | null {
    const start = this.peek().span.start;
    if (!this.expect('lbrace', '`{` to start an object')) return null;
    const fields: Field[] = [];
    if (!this.check('rbrace')) {
      for (;;) {
        const keyTok = this.peek();
        let key: string;
        if (keyTok.type === 'ident') key = this.advance().value;
        else if (keyTok.type === 'string') key = this.makeStringLit(this.advance()).value;
        else {
          this.error(Codes.UNEXPECTED_TOKEN, `expected a field name, found ${describeToken(keyTok)}`, keyTok.span);
          return null;
        }
        if (!this.expect('colon', '`:` after the field name')) return null;
        const value = this.parseFieldValue();
        if (!value) return null;
        fields.push({ type: 'Field', key, value, span: { start: keyTok.span.start, end: value.span.end } });
        if (this.check('comma')) {
          this.advance();
          if (this.check('rbrace')) break; // trailing comma
          continue;
        }
        break;
      }
    }
    if (!this.expect('rbrace', '`}` to close the object')) return null;
    return { type: 'ObjectLit', fields, span: this.spanFrom(start) };
  }

  private parseArray(): ArrayLit | null {
    const start = this.peek().span.start;
    if (!this.expect('lbracket', '`[` to start an array')) return null;
    const elements: FieldValue[] = [];
    if (!this.check('rbracket')) {
      for (;;) {
        const el = this.parseFieldValue();
        if (!el) return null;
        elements.push(el);
        if (this.check('comma')) {
          this.advance();
          if (this.check('rbracket')) break;
          continue;
        }
        break;
      }
    }
    if (!this.expect('rbracket', '`]` to close the array')) return null;
    return { type: 'ArrayLit', elements, span: this.spanFrom(start) };
  }

  private parseInterp(): Interp | null {
    const start = this.peek().span.start;
    if (!this.expect('lbrace', '`{` to start an interpolation')) return null;
    const first = this.expect('ident', 'a variable name inside `{…}`');
    if (!first) return null;
    const ref: PathSegment[] = [{ kind: 'prop', name: first.value }];
    while (this.check('dot') || this.check('lbracket')) {
      if (this.check('dot')) {
        this.advance();
        const name = this.expect('ident', 'a property name after `.`');
        if (!name) break;
        ref.push({ kind: 'prop', name: name.value });
      } else {
        this.advance();
        const idx = this.expect('number', 'an array index');
        this.expect('rbracket', '`]` to close the index');
        ref.push({ kind: 'index', index: idx ? Number(idx.value) : 0 });
      }
    }
    if (!this.expect('rbrace', '`}` to close the interpolation')) return null;
    return { type: 'Interp', ref, span: this.spanFrom(start) };
  }

  private makeStringLit(tok: Token): StringLit {
    return { type: 'StringLit', value: tok.value, parts: parseStringParts(tok.value), span: tok.span };
  }

  // -- token helpers ---------------------------------------------------------

  private peek(k = 0): Token {
    const idx = this.pos + k;
    return this.tokens[idx] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1] ?? this.tokens[0]!;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos]!;
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private check(type: Token['type']): boolean {
    return this.peek().type === type;
  }

  private atEof(): boolean {
    return this.check('eof');
  }

  private isKw(tok: Token, word: string): boolean {
    return tok.type === 'ident' && tok.value === word;
  }

  private isMethodWord(tok: Token): boolean {
    return tok.type === 'ident' && (METHODS as readonly string[]).includes(tok.value.toUpperCase());
  }

  private expect(type: Token['type'], what: string): Token | null {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `expected ${what}, found ${describeToken(tok)}`, tok.span, `expected ${describeTokenType(type)}`);
    return null;
  }

  private expectKw(word: string): boolean {
    if (this.isKw(this.peek(), word)) {
      this.advance();
      return true;
    }
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `expected \`${word}\`, found ${describeToken(tok)}`, tok.span);
    return false;
  }

  private expectString(what: string): StringLit | null {
    const tok = this.expect('string', what);
    return tok ? this.makeStringLit(tok) : null;
  }

  /** Consume the trailing NEWLINE; if trailing tokens remain, report once and recover to line end. */
  private endLine(): void {
    if (this.check('newline')) {
      this.advance();
      return;
    }
    if (this.atEof() || this.check('dedent')) return;
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `unexpected ${describeToken(tok)} at end of step`, tok.span, 'expected end of line');
    this.synchronize();
  }

  private synchronize(): void {
    while (!this.atEof() && !this.check('newline') && !this.check('dedent')) this.advance();
    if (this.check('newline')) this.advance();
  }

  private skipNewlines(): void {
    while (this.check('newline')) this.advance();
  }

  private spanFrom(start: Position): Span {
    return { start, end: this.previous().span.end };
  }

  private error(code: string, message: string, span: Span, hint?: string, label?: string): void {
    this.diagnostics.push({ code, severity: 'error', message, span, ...(hint ? { hint } : {}), ...(label ? { label } : {}) });
  }
}

function toMs(n: number, unit: 'ms' | 's' | 'm'): number {
  switch (unit) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
  }
}

/** Split a decoded string value into literal text and `{ref}` interpolation holes. */
export function parseStringParts(value: string): StringPart[] {
  const parts: StringPart[] = [];
  let text = '';
  let i = 0;
  while (i < value.length) {
    const ch = value[i]!;
    if (ch === '{') {
      const close = value.indexOf('}', i + 1);
      if (close !== -1) {
        const inner = value.slice(i + 1, close);
        const ref = parseRefText(inner);
        if (ref) {
          if (text) {
            parts.push({ kind: 'text', value: text });
            text = '';
          }
          parts.push({ kind: 'interp', ref });
          i = close + 1;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  if (text) parts.push({ kind: 'text', value: text });
  return parts;
}

/** Parse `orderId`, `body.id`, `items[0].price` into path segments, or null if malformed. */
function parseRefText(text: string): PathSegment[] | null {
  const trimmed = text.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\s*\.\s*[A-Za-z_][A-Za-z0-9_]*|\s*\[\s*\d+\s*\])*$/.test(trimmed)) return null;
  const segs: PathSegment[] = [];
  const re = /\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*(\d+)\s*\]|^([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m[3] !== undefined) segs.push({ kind: 'prop', name: m[3] });
    else if (m[1] !== undefined) segs.push({ kind: 'prop', name: m[1] });
    else if (m[2] !== undefined) segs.push({ kind: 'index', index: Number(m[2]) });
  }
  return segs.length > 0 ? segs : null;
}

export function parse(tokens: readonly Token[]): ParseResult {
  return new Parser(tokens).parse();
}

export function parseConfig(tokens: readonly Token[]): ConfigResult {
  return new Parser(tokens).parseConfig();
}
