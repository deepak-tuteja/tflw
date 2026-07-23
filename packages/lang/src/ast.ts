// AST for the testFlow M0 surface. See GRAMMAR.md § Syntactic. Every node carries a `span`
// for diagnostics and (later) report step→source mapping. Nodes are plain data (serialisable
// to JSON for golden AST snapshots) — the parser owns construction, the checker/runtime read.

import type { Span } from './token.js';

export interface Node {
  readonly type: string;
  readonly span: Span;
}

// ---- Program & tests -------------------------------------------------------

export interface Program extends Node {
  readonly type: 'Program';
  /** `import "./shared/x.tflw"` — pulls in another file's `action`s (P#17, SPEC §8). */
  readonly imports: readonly ImportDecl[];
  /** `use "./helpers/x.ts"` — the JS/TS escape hatch (P#11, SPEC §11). */
  readonly uses: readonly UseDecl[];
  /** File-scoped `action` declarations (P#17); shared across files via `imports`. */
  readonly actions: readonly ActionDecl[];
  /** `before`/`after` (file + each) — setup/teardown around this file's tests (SPEC §4.2, P#10/19). */
  readonly hooks: readonly HookDecl[];
  readonly tests: readonly TestDecl[];
}

/** `before`/`before file`/`after`/`after file` — file-scoped, no name, same body shape as a test
 * (SPEC §4.2). `each` hooks share a scope with the test they wrap (setup data / read it back for
 * cleanup); `file` hooks run once, in their own scope, isolated from any test. */
export interface HookDecl extends Node {
  readonly type: 'HookDecl';
  readonly when: 'before' | 'after';
  readonly scope: 'file' | 'each';
  readonly body: readonly Step[];
}

export interface ImportDecl extends Node {
  readonly type: 'ImportDecl';
  readonly path: StringLit;
}

export interface UseDecl extends Node {
  readonly type: 'UseDecl';
  readonly path: StringLit;
}

/** `action create order(name) ... give id` — the reuse unit (P#17). Body reuses ordinary `Step`s
 * plus `GiveStmt`; multi-word names read like a sentence and are called `create order("Widget")`. */
export interface ActionDecl extends Node {
  readonly type: 'ActionDecl';
  readonly name: string;
  readonly params: readonly string[];
  readonly body: readonly Step[];
}

export interface TestDecl extends Node {
  readonly type: 'TestDecl';
  readonly name: StringLit;
  readonly tags: readonly string[];
  /** `as <session>` opt-in(s) — `as admin, userA` opts into several independent, unrelated
   * sessions at once (SPEC §3.3); empty when anonymous. Order is significant: later-listed
   * sessions win header/cookie conflicts against earlier ones (same "later source replaces"
   * rule the whole precedence chain already follows). */
  readonly sessions: readonly string[];
  /** `retry N` — up to N re-runs on failure; a pass on any attempt is reported `flaky`, never
   * silently green (SPEC §4.4, P#10). `0` (the default) means no retry. */
  readonly retry: number;
  /** `with each` — one reported case per row, or null for an ordinary single-case test
   * (SPEC §4.3, P#10/24). */
  readonly table: DataTable | null;
  readonly body: readonly Step[];
}

export type DataTable = InlineDataTable | FileDataTable;

/** `with each` inline table — header row + data rows; cells are full expressions incl.
 * generators, evaluated fresh per row at case start (SPEC §4.3). */
export interface InlineDataTable extends Node {
  readonly type: 'InlineDataTable';
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Value[])[];
}

/** `with each from "./x.csv"` / `.json` — same semantics, rows loaded from a file at run time,
 * columns bound by header/key name. No compile-time column check: unlike the inline form, the
 * columns aren't known until the file is read (SPEC §4.3). */
export interface FileDataTable extends Node {
  readonly type: 'FileDataTable';
  readonly path: StringLit;
}

export type Step = ApiStep | ExpectStmt | LetStmt | CaptureStmt | WaitUntilApiStmt | GiveStmt | HeaderStmt;

/** `give <expr>` — an action's return value; ends its step sequence (P#17). */
export interface GiveStmt extends Node {
  readonly type: 'GiveStmt';
  readonly value: Value;
}

/** `header "Authorization" is "Bearer {token}"` — a bare header capture, only meaningful inside a
 * `session` block (SPEC §3.3, P#42): the runtime records it and auto-applies it to the api steps
 * of tests running `as <session>`. The parser only accepts this step inside a session body; it
 * never appears in an ordinary test/action/hook. */
export interface HeaderStmt extends Node {
  readonly type: 'HeaderStmt';
  readonly name: StringLit;
  readonly value: Value;
}

// ---- API steps -------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** Shared shape of an api request line — used by `ApiStep` and `wait until api` (SPEC §5.5). */
export interface ApiRequestSpec {
  /** Named service (P#29), or null for the default `api`. */
  readonly service: string | null;
  readonly method: HttpMethod;
  readonly path: PathExpr;
  readonly body: ApiBody | null;
  /** Per-step request headers from an indented `header "…" is …` sub-block (SPEC §5.1). */
  readonly headers: readonly ApiHeader[];
  /** `timeout <dur>` override for this request only, or null for the config default (SPEC §5.1). */
  readonly timeoutMs: number | null;
  /** false when `without redirects` is present — the 3xx itself becomes observable (SPEC §5.1). */
  readonly followRedirects: boolean;
  /** `retry honoring "Retry-After" up to N` sub-block clause (SPEC §5.1, PLAN decision 102,
   * enterprise arc cluster 3), or null for today's unchanged single-attempt behavior. Only ever
   * set on a plain `api` step — `wait until api` already has its own poll-until-expect-passes
   * retry mechanism and never parses this clause (`parseWaitUntilBody` doesn't call
   * `parseApiHeaders`), so it stays null there. */
  readonly retryAfter: RetryAfterClause | null;
}

export interface ApiStep extends Node, ApiRequestSpec {
  readonly type: 'ApiStep';
}

/** `retry honoring "Retry-After" up to N` — re-issues *just this one request* (not the whole
 * test, unlike `test … retry N`) when its response carries a `Retry-After` header, sleeping the
 * indicated duration before each re-attempt, up to `max` extra attempts (SPEC §5.1, PLAN
 * decision 102b, enterprise arc cluster 3, closes TFLW-GAPS.md gap #5). */
export interface RetryAfterClause extends Node {
  readonly type: 'RetryAfterClause';
  readonly max: number;
}

/** `wait until api …` — re-issues the request until its nested expects pass or wait times out (P#15). */
export interface WaitUntilApiStmt extends Node {
  readonly type: 'WaitUntilApiStmt';
  readonly request: ApiRequestSpec;
  readonly expects: readonly ExpectStmt[];
}

export interface ApiHeader extends Node {
  readonly type: 'ApiHeader';
  readonly name: StringLit;
  readonly value: Value;
}

export interface PathExpr extends Node {
  readonly type: 'PathExpr';
  /** Raw path text incl. query string and `{interpolation}`; resolved at runtime. */
  readonly raw: string;
}

// ---- Request bodies (SPEC §5.2 — four forms + raw text) --------------------

export type ApiBody = InlineBody | FileBody | FormBody | TextBody | UploadBody;

export interface InlineBody extends Node {
  readonly type: 'InlineBody';
  readonly object: ObjectLit;
}

/** `body from "./payloads/x.json"` — file is a template; `{vars}` interpolate at send time. */
export interface FileBody extends Node {
  readonly type: 'FileBody';
  readonly path: StringLit;
}

/** `form k=v, …` — `application/x-www-form-urlencoded`. */
export interface FormBody extends Node {
  readonly type: 'FormBody';
  readonly fields: readonly FormField[];
}

export interface FormField extends Node {
  readonly type: 'FormField';
  readonly key: string;
  readonly value: Value;
}

/** `body text "…"` — raw payload, no JSON content-type. */
export interface TextBody extends Node {
  readonly type: 'TextBody';
  readonly value: StringLit;
}

/** `upload "./f" as "field"` (+ optional `type "mime/type"`, + optional `form k=v, …`) —
 * multipart/form-data. `contentType` null means infer from the file extension at run time
 * (decision 22/M19), falling back to `application/octet-stream` for an unrecognized extension. */
export interface UploadBody extends Node {
  readonly type: 'UploadBody';
  readonly filePath: StringLit;
  readonly fieldName: StringLit;
  readonly contentType: StringLit | null;
  readonly extra: readonly FormField[];
}

// ---- Assertions ------------------------------------------------------------

export interface ExpectStmt extends Node {
  readonly type: 'ExpectStmt';
  /** `true` for `check` (soft — records and continues), `false` for `expect` (hard — fails fast). */
  readonly soft: boolean;
  /** `any`/`all` array quantifier over a body-array path (P#14, SPEC §6.3), or null for a plain expect. */
  readonly quantifier: 'any' | 'all' | null;
  readonly subject: Subject;
  readonly matcher: Matcher;
}

export type Subject = StatusSubject | DurationSubject | HeaderSubject | BodySubject | BodyTextSubject | RequestSubject;

export interface StatusSubject extends Node {
  readonly type: 'StatusSubject';
}

/** `request` — the connection attempt itself, not the response (SPEC §5.3/§6.2.2, PLAN decision
 * 18, enterprise arc cluster 5.5). Only meaningful with the `connects`/`fails` matchers; carries
 * no data of its own to navigate (unlike every other subject, which reads the response). */
export interface RequestSubject extends Node {
  readonly type: 'RequestSubject';
}

export interface DurationSubject extends Node {
  readonly type: 'DurationSubject';
}

export interface HeaderSubject extends Node {
  readonly type: 'HeaderSubject';
  readonly name: StringLit;
}

export interface BodySubject extends Node {
  readonly type: 'BodySubject';
  /** Empty path = the whole body; otherwise dot/index segments (`body.items[0].price`). */
  readonly path: readonly PathSegment[];
}

/** `body text` — the raw response body as a string, for non-JSON (text/HTML/XML) responses
 * (SPEC §5.3, decision 51). Distinct from `BodySubject`, which requires a JSON response. */
export interface BodyTextSubject extends Node {
  readonly type: 'BodyTextSubject';
}

export type PathSegment =
  | { readonly kind: 'prop'; readonly name: string }
  | { readonly kind: 'index'; readonly index: number };

export type MatcherName =
  | 'equals'
  | 'contains'
  | 'matches'
  | 'matchesSubset'
  | 'matchesSchema'
  | 'greaterThan'
  | 'lessThan'
  | 'hasCount'
  | 'hasValue'
  | 'visible'
  | 'hidden'
  | 'enabled'
  | 'disabled'
  | 'checked'
  | 'connects'
  | 'fails';

export interface Matcher extends Node {
  readonly type: 'Matcher';
  readonly name: MatcherName;
  readonly negated: boolean;
  /** Operand for value matchers (equals/contains/…); null for state matchers (visible/…) and for
   * `matchesSchema` (which uses `schemaName`/`schemaSource` instead). Also holds `fails`'s
   * optional `matching "text"` regex operand (SPEC §6.2.2, decision 18) — null for a bare
   * `fails`; always null for `connects`, which never takes an operand. */
  readonly value: Value | null;
  /** `matches schema "Name" from "source"` (SPEC, PLAN decision 102a, enterprise arc cluster 3,
   * closes TFLW-GAPS.md gap #6) — set only when `name === 'matchesSchema'`. `schemaName` is the
   * `components.schemas` key to validate against; `schemaSource` is the OpenAPI document's URL
   * (absolute) or path (resolved against the default service's base URL). */
  readonly schemaName?: StringLit;
  readonly schemaSource?: StringLit;
}

// ---- Bindings --------------------------------------------------------------

export interface LetStmt extends Node {
  readonly type: 'LetStmt';
  readonly name: string;
  readonly value: Value;
}

export interface CaptureStmt extends Node {
  readonly type: 'CaptureStmt';
  readonly subject: Subject;
  readonly name: string;
}

// ---- Values & literals -----------------------------------------------------

export type Value =
  | StringLit
  | NumberLit
  | DurationLit
  | BoolLit
  | NullLit
  | VarRef
  | Interp
  | EnvRef
  | ObjectLit
  | ArrayLit
  | BinaryExpr
  | DateAtom
  | DateOffsetLit
  | FormatExpr
  | GeneratorExpr
  | TransformExpr
  | CallExpr;

/** A call to an `action` or a `use`d JS/TS helper function — `create order("Widget")` or
 * `sign payload({body})` (P#11, P#17). `name` is the space-joined multi-word call name; which
 * kind of callable it resolves to is a runtime concern (SPEC §8, §11). */
export interface CallExpr extends Node {
  readonly type: 'CallExpr';
  readonly name: string;
  readonly args: readonly Value[];
}

/** A number immediately followed by a time unit (`500ms`, `2s`, `1m`) — always stored as ms (SPEC §5.3). */
export interface DurationLit extends Node {
  readonly type: 'DurationLit';
  readonly ms: number;
}

// ---- Value expressions: arithmetic + date math (P#25, SPEC §7.5) ----------

export type BinaryOp = '+' | '-' | '*' | '/';

/** Closed arithmetic grammar: `+ - * /` on numbers, or `+`/`-` between a `DateAtom` and a
 * `DateOffsetLit` (`today + 3 days`). No parens, no other operators — the hard fence (P#25). */
export interface BinaryExpr extends Node {
  readonly type: 'BinaryExpr';
  readonly op: BinaryOp;
  readonly left: Value;
  readonly right: Value;
}

/** `today` (local midnight) or `now` (current instant). */
export interface DateAtom extends Node {
  readonly type: 'DateAtom';
  readonly which: 'today' | 'now';
}

export type DateOffsetUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks';

/** A number followed by a spelled-out date unit (`3 days`) — only meaningful next to a `DateAtom`
 * on one side of a `BinaryExpr` (`today + 3 days`); distinct from `DurationLit`'s tight `500ms`. */
export interface DateOffsetLit extends Node {
  readonly type: 'DateOffsetLit';
  readonly amount: number;
  readonly unit: DateOffsetUnit;
}

/** `format <value> as "<pattern>"` — renders a date value with a `yyyy`/`MM`/`dd`/`HH`/`mm`/`ss` pattern. */
export interface FormatExpr extends Node {
  readonly type: 'FormatExpr';
  readonly value: Value;
  readonly pattern: StringLit;
}

/** `base64 encode(...)`/`decode(...)`, `hex encode(...)`/`decode(...)`, `url encode(...)`/
 * `decode(...)` — pure value transforms, not fresh-value generators (SPEC §7.6, decision 98). */
export interface TransformExpr extends Node {
  readonly type: 'TransformExpr';
  readonly kind: 'base64' | 'hex' | 'url';
  readonly direction: 'encode' | 'decode';
  readonly value: Value;
}

// ---- Generators: `unique`/`random` (P#19, P#21–23, SPEC §7.2–7.4) ----------

export type GeneratorExpr =
  | UniquePrefixExpr
  | UniqueEmailExpr
  | UniqueNumberExpr
  | UniqueLikeExpr
  | UniqueUuidExpr
  | RandomNumberExpr
  | RandomDecimalExpr
  | RandomDateInPastExpr
  | RandomDateInFutureExpr
  | RandomDateBetweenExpr
  | RandomOfExpr
  | RandomStringExpr
  | RandomLikeExpr
  | RandomUuidExpr
  | RandomPasswordExpr;

/** `unique("prefix")` — collision-safe identity data, run/worker-seeded (P#19, P#21). */
export interface UniquePrefixExpr extends Node {
  readonly type: 'UniquePrefixExpr';
  readonly prefix: Value;
}

/** `unique email`. */
export interface UniqueEmailExpr extends Node {
  readonly type: 'UniqueEmailExpr';
}

/** `unique number`. */
export interface UniqueNumberExpr extends Node {
  readonly type: 'UniqueNumberExpr';
}

/** `unique like "ORD-######"` — `#` digit, `?` letter, guaranteed distinct per call (P#22). */
export interface UniqueLikeExpr extends Node {
  readonly type: 'UniqueLikeExpr';
  readonly pattern: StringLit;
}

/** `unique uuid` — v4-shaped, with the run-wide counter embedded so distinctness is a true
 * guarantee (decision 98), not just low collision probability. */
export interface UniqueUuidExpr extends Node {
  readonly type: 'UniqueUuidExpr';
}

/** `random number A to B` — collisions allowed (P#21). */
export interface RandomNumberExpr extends Node {
  readonly type: 'RandomNumberExpr';
  readonly from: Value;
  readonly to: Value;
}

/** `random decimal A to B`. */
export interface RandomDecimalExpr extends Node {
  readonly type: 'RandomDecimalExpr';
  readonly from: Value;
  readonly to: Value;
}

/** `random date in past`. */
export interface RandomDateInPastExpr extends Node {
  readonly type: 'RandomDateInPastExpr';
}

/** `random date in future`. */
export interface RandomDateInFutureExpr extends Node {
  readonly type: 'RandomDateInFutureExpr';
}

/** `random date between A and B`. */
export interface RandomDateBetweenExpr extends Node {
  readonly type: 'RandomDateBetweenExpr';
  readonly from: Value;
  readonly to: Value;
}

/** `random of "red", "blue", "green"`. */
export interface RandomOfExpr extends Node {
  readonly type: 'RandomOfExpr';
  readonly choices: readonly Value[];
}

/** `random string N` — alnum string of length N. */
export interface RandomStringExpr extends Node {
  readonly type: 'RandomStringExpr';
  readonly length: Value;
}

/** `random like "SKU-####-??"` — `#` digit, `?` letter, collisions allowed (P#22). */
export interface RandomLikeExpr extends Node {
  readonly type: 'RandomLikeExpr';
  readonly pattern: StringLit;
}

/** `random uuid` — plain v4 UUID, collisions allowed (decision 98). */
export interface RandomUuidExpr extends Node {
  readonly type: 'RandomUuidExpr';
}

/** `random password` (default length 12) or `random password 16` — always at least one
 * upper/lower/digit/symbol regardless of length (decision 98); no `unique` counterpart since
 * passwords carry no real-world uniqueness constraint. */
export interface RandomPasswordExpr extends Node {
  readonly type: 'RandomPasswordExpr';
  readonly length?: Value;
}

/** `env(NAME)` — reads a secret; its value is taint-tracked and redacted in reports (P#30). */
export interface EnvRef extends Node {
  readonly type: 'EnvRef';
  readonly name: string;
}

export interface StringLit extends Node {
  readonly type: 'StringLit';
  /** Decoded string value (no quotes, escapes applied). */
  readonly value: string;
  /** Interpolation-aware breakdown: literal text and `{ref}` holes, in source order. */
  readonly parts: readonly StringPart[];
}

export type StringPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'interp'; readonly ref: readonly PathSegment[] };

export interface NumberLit extends Node {
  readonly type: 'NumberLit';
  readonly value: number;
  readonly raw: string;
}

export interface BoolLit extends Node {
  readonly type: 'BoolLit';
  readonly value: boolean;
}

export interface NullLit extends Node {
  readonly type: 'NullLit';
}

/** A bare identifier reference — a variable / capture binding used as a value. */
export interface VarRef extends Node {
  readonly type: 'VarRef';
  readonly name: string;
}

/** A standalone `{ref}` interpolation used in value position (e.g. inside a body object). */
export interface Interp extends Node {
  readonly type: 'Interp';
  readonly ref: readonly PathSegment[];
}

export interface ObjectLit extends Node {
  readonly type: 'ObjectLit';
  readonly fields: readonly Field[];
}

export interface Field extends Node {
  readonly type: 'Field';
  readonly key: string;
  readonly value: FieldValue;
}

export type FieldValue = Value;

export interface ArrayLit extends Node {
  readonly type: 'ArrayLit';
  readonly elements: readonly FieldValue[];
}

// ---- Config dialect (tflw.config, P#27–31) ---------------------------------

export interface ConfigFile extends Node {
  readonly type: 'ConfigFile';
  readonly defaults: DefaultsBlock | null;
  readonly envs: readonly EnvBlock[];
  readonly requires: readonly RequireDecl[];
  /** `session <name> ... ` blocks — the single auth concept (SPEC §3.3, P#20/31/42). */
  readonly sessions: readonly SessionDecl[];
}

/** `session <name> ... steps ...` — runs once per run per worker; its `header` steps become the
 * headers auto-applied to the api steps of tests running `as <name>` (SPEC §3.3, P#42). Body
 * steps are ordinary parsed steps (api/let/capture/wait) plus `header`. A session declared
 * `oauth2` (decision 3c, enterprise arc) uses `oauth2` sugar instead of a hand-written body — the
 * two are mutually exclusive: `oauth2` set means `body` is always `[]`. */
export interface SessionDecl extends Node {
  readonly type: 'SessionDecl';
  readonly name: string;
  readonly oauth2: Oauth2SessionConfig | null;
  readonly body: readonly Step[];
}

/** `session <name> oauth2 / token url … / client id … / client secret … / scope …` — OAuth2
 * client-credentials sugar (SPEC §3.3, decision 3c, enterprise arc). The runtime POSTs the
 * client-credentials grant to `tokenUrl`, turns `access_token` into the session's `Authorization:
 * Bearer` header, and `expires_in` (when the server sends one) into the session's refresh TTL —
 * the same outcome a hand-written session produces via `capture`/`header`, without writing it by
 * hand. `clientId`/`clientSecret`/`scope` are full `Value`s (not bare strings) so `env(...)` works
 * the same way it does everywhere else in the config dialect. */
export interface Oauth2SessionConfig extends Node {
  readonly type: 'Oauth2SessionConfig';
  readonly tokenUrl: Value;
  readonly clientId: Value;
  readonly clientSecret: Value;
  readonly scope: Value | null;
}

export interface DefaultsBlock extends Node {
  readonly type: 'DefaultsBlock';
  readonly entries: readonly ConfigEntry[];
}

export interface EnvBlock extends Node {
  readonly type: 'EnvBlock';
  readonly name: string;
  /** Marked `default` — the fallback active env when no --env / TFLW_ENV (P#28). */
  readonly isDefault: boolean;
  readonly entries: readonly ConfigEntry[];
}

export type ConfigEntry =
  | HeaderDecl
  | TimeoutDecl
  | WorkersDecl
  | ReportDecl
  | WebDecl
  | ApiServiceDecl
  | InsecureDecl
  | CertDecl
  | KeyDecl
  | AllowHostsDecl
  | EvidenceDecl
  | RedactDecl;

export interface HeaderDecl extends Node {
  readonly type: 'HeaderDecl';
  readonly name: StringLit;
  readonly value: Value;
  /** `… for <service>` scoping, or null for all services (P#29). */
  readonly service: string | null;
}

export type TimeoutTarget = 'step' | 'expect' | 'wait';

export interface TimeoutDecl extends Node {
  readonly type: 'TimeoutDecl';
  readonly target: TimeoutTarget;
  readonly ms: number;
}

export interface WorkersDecl extends Node {
  readonly type: 'WorkersDecl';
  readonly count: number;
}

export interface ReportDecl extends Node {
  readonly type: 'ReportDecl';
  readonly dir: string;
}

export interface WebDecl extends Node {
  readonly type: 'WebDecl';
  readonly url: StringLit;
}

/** `insecure true|false` — disables TLS certificate verification for the whole run when true
 * (decision 78). Explicit and greppable in review; the runtime warns visibly wherever it applies. */
export interface InsecureDecl extends Node {
  readonly type: 'InsecureDecl';
  readonly value: boolean;
}

/** `cert "<path>"` — per-env mTLS client certificate (SPEC §3.5, decision 3b, enterprise arc).
 * Always paired with `key`; the runtime rejects one without the other once defaults+env are
 * merged (resolve.ts), since a split-across-blocks pairing can't be caught at parse time. */
export interface CertDecl extends Node {
  readonly type: 'CertDecl';
  readonly path: StringLit;
}

/** `key "<path>"` — the private key paired with `cert` (SPEC §3.5, decision 3b). */
export interface KeyDecl extends Node {
  readonly type: 'KeyDecl';
  readonly path: StringLit;
}

/** `allow hosts "host", "host2"` — a request whose URL's hostname matches none of these is
 * refused before any network I/O (SPEC §3.7, PLAN decision 101a, enterprise arc cluster 2). A
 * pattern starting with `*.` matches that suffix or the bare domain; anything else must match
 * exactly. Accumulates across `defaults` + `env` (same push semantics as `HeaderDecl`, not the
 * override semantics `insecure`/`workers` use) — declare a baseline allowlist in `defaults` and
 * extend it per env. */
export interface AllowHostsDecl extends Node {
  readonly type: 'AllowHostsDecl';
  readonly hosts: readonly StringLit[];
}

export type EvidenceLevel = 'full' | 'headers-only' | 'none';

/** `evidence full|headers-only|none` — how much of the request/response trace lands in the
 * report (SPEC §13, PLAN decision 101c). Overrides like `insecure` (env wins over defaults), and
 * `--evidence` overrides this at the CLI for one run. Trims the report-only trace; never affects
 * what `expect`/`capture` can see. */
export interface EvidenceDecl extends Node {
  readonly type: 'EvidenceDecl';
  readonly level: EvidenceLevel;
}

/** A single `redact` target: `body` followed by one or more `.prop`/`.* ` segments. Deliberately
 * a separate, minimal path type from `PathSegment` (used by `expect`/`capture`) — those never
 * need wildcards and shouldn't silently gain them just because `redact` does. */
export type RedactPathSegment = { readonly kind: 'prop'; readonly name: string } | { readonly kind: 'wildcard' };

export interface RedactPattern {
  readonly root: 'body';
  readonly segments: readonly RedactPathSegment[];
}

/** `redact body.email, body.*.address` — masks matching JSON fields with `[redacted]` in the
 * report-only trace before it's written (SPEC §3.4, PLAN decision 101d, enterprise arc cluster
 * 2). Accumulates across `defaults` + `env`, same as `AllowHostsDecl`. Distinct mechanism from
 * the existing taint-based secret redaction (`env(...)` values, `redact.ts`) — this one is
 * path-based and doesn't require the value to have come from an env var. */
export interface RedactDecl extends Node {
  readonly type: 'RedactDecl';
  readonly patterns: readonly RedactPattern[];
}

export interface ApiServiceDecl extends Node {
  readonly type: 'ApiServiceDecl';
  /** Extra named service, or null for the default `api` base URL (P#29). */
  readonly service: string | null;
  readonly url: StringLit;
}

export interface RequireDecl extends Node {
  readonly type: 'RequireDecl';
  readonly names: readonly string[];
}
