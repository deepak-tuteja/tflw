// Evaluate AST values against a running scope: string interpolation, `env(…)` secrets (which
// register for redaction), variable/capture references, JSON body shapes, arithmetic/date-math
// expressions, and the `unique`/`random` generator family (M2, SPEC §7).

import { isDecodableBase64, isDecodableHex, isDecodablePercentEncoding, parseStringParts, type BinaryOp, type DateOffsetUnit, type PathSegment, type StringPart, type Value } from '@tflw/lang';
import type { Redactor } from './redact.js';
import { subSeed, mulberry32, hashString, SEED_DOMAIN } from './seed.js';
import type { CookieJar } from './cookieJar.js';
import type { BrowserManager, BrowserPageState, LocatorScope } from './browser.js';
import type { SessionRef } from './interpreter.js';
import type { Finding } from './finding.js';
import type { Observation } from './securityRules.js';
import type { StepResult } from './types.js';

/** This test attempt's browser state (M3a) — present whenever the run was given a
 * `BrowserManager` (SPEC §9), regardless of whether this particular test ends up using a browser
 * step; the manager/page are both lazy (no real browser process/page until first actual use).
 * `scope` narrows on entry to a `within` block (a fresh child `EvalCtx`, D7, SPEC §9.3) and is
 * restored automatically on exit since it's never mutated in place. */
export interface BrowserAttemptContext {
  readonly manager: BrowserManager;
  readonly page: BrowserPageState;
  readonly scope: LocatorScope | null;
}

export class RuntimeError extends Error {
  /** The `action` frames this failure surfaced through, outermost first — empty for a failure that
   * happened directly in a test, a hook or a session body (M97d, D141). It exists so `execCall` can
   * record its frame *structurally* instead of prefixing `action "x" failed: ` onto the message at
   * every level: that prefixing was unbounded, and a 671-frame recursion turned one failing step
   * into a 14,505-character single line, a 32 KB `results.json` and a 55 KB `report.html`. */
  readonly actionPath: readonly string[];
  /** The failure's own message, with no action framing around it — what `renderActionFailure`
   * re-renders against `actionPath` one frame up. Equal to `message` when `actionPath` is empty. */
  readonly rootMessage: string;

  constructor(message: string, actionPath: readonly string[] = [], rootMessage: string = message) {
    super(message);
    this.name = 'RuntimeError';
    this.actionPath = actionPath;
    this.rootMessage = rootMessage;
  }
}

export interface EvalCtx {
  /** Variables in scope: `let` bindings and `capture`d response values. */
  readonly scope: Map<string, unknown>;
  readonly environ: NodeJS.ProcessEnv;
  readonly redactor: Redactor;
  /** This test's seeded PRNG — `random` draws from it (P#23). */
  readonly rng: () => number;
  /** The run seed, so `unique like` can derive a fresh, still-deterministic local RNG per call. */
  readonly runSeed: number;
  /** The run clock (`--now <iso>`, or the real instant the run started) — `today`/`now` and
   * `random date in past`/`in future` derive from this, not a fresh `Date.now()` per call, so
   * `--seed` + `--now` together reproduce absolute dates exactly (P#23, decision 52). */
  readonly runClock: Date;
  /** Monotonic counter shared by the whole run — `unique` derives its guarantee from this, not
   * from randomness (P#19, P#21). */
  readonly uniqueSeq: { next(): number };
  /** Headers captured by the `as <session>` this test opted into (already evaluated + stringified
   * at session-run time), auto-applied to this test's api steps — `{}` when anonymous (SPEC §3.3,
   * P#42). */
  readonly sessionHeaders: Readonly<Record<string, string>>;
  /** M137b (D433) — the `csrfHeaders` half of the same opt-in, applied by `execApi` to **mutating**
   * requests only. Optional rather than `{}`-always because every `EvalCtx` literal predating this
   * milestone would otherwise have to name it to say "none", and `undefined`-means-none is the
   * doctrine this interface already uses for `securitySink` and `sessionRefs`. */
  readonly sessionCsrfHeaders?: Readonly<Record<string, string>>;
  /** Names of the `as <session>[, ...]` sessions this test opted into, `[]` outside a test (a
   * session's own run, a file hook) or for an anonymous test (SPEC §3.3, decision 3a, enterprise
   * arc). Lets an `ApiStep` that gets a 401 know which session(s) to invalidate + re-establish
   * before retrying once — the general auto-refresh-on-401 mechanism every session gets "for
   * free", not just `oauth2` ones. */
  readonly sessionNames: readonly string[];
  /** M128b/D287 — security findings from the *login responses* of the sessions this test opted
   * into, scanned once when each session was established and carried here so that every
   * `expect response has no … security violations` in the test can see them.
   *
   * Without this, Tier 1 reports clean on a suite whose session cookie lacks `HttpOnly` — close to
   * the single most important thing the pack could catch, and precisely the shape of the real
   * `cookie-not-secure` defect that scoping this arc turned up in `testFlow-tests`. The session's
   * login response is a response the run genuinely made; nothing here inspects a cookie jar or
   * invents a cross-request subject (both were rejected in D287).
   *
   * Empty for an anonymous test, and `undefined` outside a test entirely. */
  readonly sessionFindings?: readonly Finding[];
  /** M128b/D287 — where a *session's own* establishment run records what its api steps observed, so
   * the scan can run against the live request/response pair rather than the redacted report copy
   * (`cookieEvents` is `[]` in that copy at every evidence level, which is exactly the field the
   * cookie rules read). Set only while a `session` block's body is executing; `undefined`
   * everywhere else, so an ordinary test pays nothing for it.
   *
   * The same sink shape `headerSink` already uses one field down, for the same reason: a session
   * body needs to hand something back that its steps produced, and the alternative is threading a
   * return value through every statement type. */
  readonly securitySink?: Observation[];
  /** Opaque `SessionCache` handles (M37, D45) for the sessions named in `sessionNames`, as of when
   * `sessionHeaders`/`cookieJar` were last read from the cache — undefined outside a load
   * iteration (a regular `tflw run`/`test` attempt never populates this). Lets a 401-triggered
   * `refreshSessions` call ask the cache "am I still looking at the live entry, or has another
   * concurrent VU already refreshed this session since I read it" and skip a redundant re-login
   * when the answer is the latter. */
  readonly sessionRefs?: ReadonlyMap<string, SessionRef>;
  /** `M146b` (`B3-20`) — a mutable sink for steps that are **real requests but not part of this
   * test's own trace**: today, exactly the requests a reactive 401 re-establish sends. The load
   * path creates one per iteration and drains it into the per-endpoint accumulator; every other
   * caller leaves it undefined and the writer becomes a no-op.
   *
   * A sink rather than a return value because the only writer, `refreshSessions`, is reached
   * through `execSteps`' recursive `api`-step branch — returning it would mean a new field on
   * `StepsExec` that every nested call site (`within`, `action`, both hook loops) has to merge
   * upward, for a value only one caller reads. Mutable by design, and the only mutable field on an
   * otherwise-readonly context, which is why it is named for what it is. */
  readonly metricsSink?: StepResult[];
  /** Present only while executing a `session` block's own steps: a `HeaderStmt` writes into this
   * instead of the (nonexistent) response/report subject it would otherwise need (P#42). */
  readonly headerSink?: Record<string, string>;
  /** M137b (D433) — the same sink shape one field up, for `csrf from … send as header "…"`, and
   * deliberately **separate from `headerSink`** rather than another entry in it.
   *
   * `headerSink` becomes `SessionOutcome.headers`, which is `Object.assign`'d onto *every* request the
   * credential makes. A CSRF token must go only on **mutating** ones: a browser does not send one on
   * a `GET`, an app that receives one there may reject it, and — the reason that actually forces the
   * split — `sec/csrf-not-enforced` (D434) derives a principal that is this credential *minus these
   * headers*, which is only expressible if "these" is a set the engine can name. Folded into
   * `headers` it would be indistinguishable from the `Authorization` header beside it, and withholding
   * it would mean withholding the identity too, which measures nothing.
   *
   * A map rather than one slot so a second `csrf from` clause is additive instead of a silent
   * overwrite — two token headers is a coherent thing to declare, and it needs no diagnostic to say so. */
  readonly csrfSink?: Record<string, string>;
  /** Cookies accumulated from every response seen so far in this scope (a `session` block's own
   * run, or one test's own attempt — including any `before`/`after` hooks and action calls sharing
   * that same attempt) — automatically attached to subsequent requests as a `Cookie` header,
   * automatically updated from every response's `Set-Cookie` (SPEC §3.3, P#33). A test opting into
   * `as <session>` starts with a *clone* of that session's own jar (§3.3) so its mutations never
   * leak back into the shared session cache or a concurrently-running sibling test. */
  readonly cookieJar: CookieJar;
  /** Undefined when the run has no `BrowserManager` at all (a test harness building `RunOptions`
   * directly without one) — a browser step reaching that case throws a clear internal error
   * instead of a null-deref (see `requireBrowserCtx` in `interpreter.ts`). */
  readonly browser?: BrowserAttemptContext;
  /** The `action` names currently executing, outermost first — `execCall` pushes one frame per
   * call and refuses a call whose name is already on it (M97d, D141). Absent means "no frames yet",
   * which is the right answer at every root: a test body, a hook, a session's own run and a load
   * iteration all begin with an empty stack, and the one child context that isn't a root
   * (`within`) is built by spreading its parent, so it inherits. */
  readonly callStack?: readonly string[];
}

export function evalValue(value: Value, ctx: EvalCtx): unknown {
  switch (value.type) {
    case 'StringLit':
      return evalParts(value.parts, ctx);
    case 'NumberLit':
      return value.value;
    case 'DurationLit':
      return value.ms;
    case 'BoolLit':
      return value.value;
    case 'NullLit':
      return null;
    case 'VarRef':
      return lookupVar(value.name, ctx);
    case 'Interp':
      return resolveRef(value.ref, ctx);
    case 'EnvRef': {
      const raw = ctx.environ[value.name];
      if (raw === undefined) throw new RuntimeError(`environment variable ${value.name} is not set (referenced by env(${value.name}))`);
      ctx.redactor.register(value.name, raw);
      return raw;
    }
    case 'ObjectLit': {
      const obj: Record<string, unknown> = {};
      for (const field of value.fields) obj[field.key] = evalValue(field.value, ctx);
      return obj;
    }
    case 'ArrayLit':
      return value.elements.map((el) => evalValue(el, ctx));
    case 'BinaryExpr':
      return evalBinary(value.op, evalValue(value.left, ctx), evalValue(value.right, ctx));
    case 'DateAtom':
      return value.which === 'today' ? startOfDay(ctx.runClock) : new Date(ctx.runClock.getTime());
    case 'DateOffsetLit':
      return { __tflwDateOffset: true, ms: offsetToMs(value.amount, value.unit) } satisfies DateOffsetValue;
    case 'FormatExpr': {
      const v = evalValue(value.value, ctx);
      if (!(v instanceof Date)) throw new RuntimeError('`format … as …` needs a date value (today/now, optionally with a date-math offset)');
      // A4-OS-13/M102: the checker binds `{var}`s in this pattern (`checker.ts`), so the runtime has
      // to read it as a value. Additive — `{` is not a placeholder in `formatDate`'s language
      // (`yyyy`/`MM`/`dd`/`HH`/`mm`/`ss`), so a pattern without one renders identically.
      return formatDate(v, String(evalValue(value.pattern, ctx)));
    }
    case 'UniquePrefixExpr': {
      const prefix = String(evalValue(value.prefix, ctx));
      return `${prefix}-${ctx.uniqueSeq.next()}`;
    }
    case 'UniqueEmailExpr':
      return `user${ctx.uniqueSeq.next()}@example.test`;
    case 'UniqueNumberExpr':
      return ctx.uniqueSeq.next();
    case 'UniqueLikeExpr':
      // A4-OS-13/M102, as in `FormatExpr` above. `uniqueLike`'s placeholders are `#` and `?`, so
      // interpolating first cannot collide with the pattern language.
      return uniqueLike(String(evalValue(value.pattern, ctx)), ctx.uniqueSeq.next());
    case 'UniqueUuidExpr':
      return uniqueUuid(ctx.uniqueSeq.next(), ctx.runSeed);
    case 'RandomNumberExpr': {
      const from = asNumber(evalValue(value.from, ctx), 'random number');
      const to = asNumber(evalValue(value.to, ctx), 'random number');
      if (to < from) throw new RuntimeError(`random number ${from} to ${to}: \`to\` must be ≥ \`from\``);
      return from + Math.floor(ctx.rng() * (to - from + 1));
    }
    case 'RandomDecimalExpr': {
      const from = asNumber(evalValue(value.from, ctx), 'random decimal');
      const to = asNumber(evalValue(value.to, ctx), 'random decimal');
      if (to < from) throw new RuntimeError(`random decimal ${from} to ${to}: \`to\` must be ≥ \`from\``);
      return from + ctx.rng() * (to - from);
    }
    case 'RandomDateInPastExpr':
      return new Date(ctx.runClock.getTime() - Math.floor(ctx.rng() * 365) * 86_400_000);
    case 'RandomDateInFutureExpr':
      return new Date(ctx.runClock.getTime() + Math.floor(ctx.rng() * 365) * 86_400_000);
    case 'RandomDateBetweenExpr': {
      const from = asDate(evalValue(value.from, ctx));
      const to = asDate(evalValue(value.to, ctx));
      // `M124-01`. The two numeric siblings twenty lines above both refuse an empty range; this one
      // computed a *negative* delta and returned a date before `from`, silently, and that value went
      // on into a request body. Same rule as theirs, and the same sentence, so a reader who has seen
      // one has seen all three (SPEC §7.3's generator-operand rule).
      if (to.getTime() < from.getTime()) {
        throw new RuntimeError(`random date between ${from.toISOString()} and ${to.toISOString()}: \`to\` must be ≥ \`from\``);
      }
      return new Date(from.getTime() + ctx.rng() * (to.getTime() - from.getTime()));
    }
    case 'RandomOfExpr': {
      const idx = Math.floor(ctx.rng() * value.choices.length);
      return evalValue(value.choices[idx]!, ctx);
    }
    case 'RandomStringExpr': {
      const len = asNumber(evalValue(value.length, ctx), 'random string');
      // `M124-02`, and the asymmetry it named is kept rather than flattened: `0` stays legal because
      // the empty string *is* a string of length 0, while no string has length -3. `randomAlnum`'s
      // loop simply never runs for either, so both used to return `""` and pass.
      if (len < 0) throw new RuntimeError(`random string ${len}: length must be 0 or more`);
      return randomAlnum(len, ctx.rng);
    }
    case 'RandomLikeExpr':
      return renderLikePattern(String(evalValue(value.pattern, ctx)), ctx.rng); // A4-OS-13/M102
    case 'RandomUuidExpr':
      return randomUuidV4(ctx.rng);
    case 'RandomPasswordExpr': {
      const length = value.length ? asNumber(evalValue(value.length, ctx), 'random password') : 12;
      if (length < 4) throw new RuntimeError(`random password ${length}: length must be at least 4 (needs room for an uppercase letter, lowercase letter, digit, and symbol)`);
      return randomPassword(length, ctx.rng);
    }
    case 'TransformExpr': {
      const input = stringify(evalValue(value.value, ctx));
      return applyTransform(value.kind, value.direction, input);
    }
  }
}

/** Interpolate a raw `{ref}`-holed string against scope. Shared by URL path building (`encodeRefs:
 * true`, decision 62) and `body from` file templates (`encodeRefs` omitted — a JSON/text body
 * must NOT have its interpolated values percent-encoded). */
export function interpolatePath(raw: string, ctx: EvalCtx, encodeRefs = false): string {
  return evalParts(parseStringParts(raw), ctx, encodeRefs);
}

function evalParts(parts: readonly StringPart[], ctx: EvalCtx, encodeRefs = false): string {
  let out = '';
  for (const part of parts) {
    if (part.kind === 'text') out += part.value;
    else {
      const rendered = stringify(resolveRef(part.ref, ctx));
      // Only the interpolated value is encoded — literal template characters (the path's own
      // `/`/`?`/`&` structure) are left alone (decision 62).
      out += encodeRefs ? encodeURIComponent(rendered) : rendered;
    }
  }
  return out;
}

/** Walk a `{name.path[0]}` reference against the variable scope. Exported for `resolveSubject`
 * (M96/`FU-11`), which resolves the same shape in subject position — the value subject is
 * *defined* as "an interpolation, standing where a response subject used to", so it has to resolve
 * through the same function or the two readings could drift. */
export function resolveRef(ref: readonly PathSegment[], ctx: EvalCtx): unknown {
  const first = ref[0];
  if (!first || first.kind !== 'prop') throw new RuntimeError('invalid reference');
  let current = lookupVar(first.name, ctx);
  for (let i = 1; i < ref.length; i++) {
    current = navigate(current, ref[i]!, describeRef(ref, i));
  }
  return current;
}

function lookupVar(name: string, ctx: EvalCtx): unknown {
  if (!ctx.scope.has(name)) throw new RuntimeError(`unknown variable "${name}" — is it defined with \`let\` or \`capture\` earlier?`);
  return ctx.scope.get(name);
}

export function navigate(value: unknown, seg: PathSegment, path: string): unknown {
  if (seg.kind === 'prop') {
    if (value === null || typeof value !== 'object') throw new RuntimeError(`cannot read \`.${seg.name}\` of ${describe(value)} at ${path}`);
    return (value as Record<string, unknown>)[seg.name];
  }
  if (!Array.isArray(value)) throw new RuntimeError(`cannot index [${seg.index}] into ${describe(value)} at ${path}`);
  return value[seg.index];
}

function describeRef(ref: readonly PathSegment[], upto: number): string {
  return ref
    .slice(0, upto + 1)
    .map((s) => (s.kind === 'prop' ? `.${s.name}` : `[${s.index}]`))
    .join('')
    .replace(/^\./, '');
}

/** Human-readable type description for error messages (e.g. "expects a number, got a date"). Shared
 * between here and `matcher.ts` — kept in one place after decision 71 found the two copies had
 * drifted (matcher.ts's was missing the `Date` case). */
export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof Date) return 'a date';
  return typeof value === 'string' ? 'a string' : typeof value;
}

/** **The** value-to-string form for the language (`SPEC` §7.5, `D813`). Every place that turns a
 * value into text for *comparison or transport* goes through here — `{interpolation}`, `encode`/
 * `decode` input, and the `matches`/`contains` matchers.
 *
 * Not to be confused with `matcher.ts`'s `repr`, which is the **display** form: it quotes strings
 * and abbreviates a binary body. One function answers *what does this value compare as*, the other
 * *how is it shown to a reader*. They are allowed to differ; what is not allowed is a third answer,
 * and `M154g-08` is what that costs — `matches` tested `String(actual)` while its failure message
 * printed `repr(actual)`, so a date subject was matched against a locale- and timezone-dependent
 * rendering and then reported as its ISO form, which satisfied the pattern it had just failed.
 *
 * The date row is the one with teeth: ISO-8601 UTC, never `Date.prototype.toString`, so the same
 * file at the same seed cannot pass on one machine's `TZ` and fail on another's. */
export function stringify(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// ---- arithmetic + date math (P#25) -----------------------------------------

interface DateOffsetValue {
  readonly __tflwDateOffset: true;
  readonly ms: number;
}

function isDateOffset(v: unknown): v is DateOffsetValue {
  return typeof v === 'object' && v !== null && (v as Partial<DateOffsetValue>).__tflwDateOffset === true;
}

/** The millisecond count behind a spelled-out time literal, or `null` for anything else
 *  (`M147d`, `A3-13`, D638).
 *
 * `2 seconds` and `2s` are the same duration and parse to different nodes: the adjacent
 * abbreviation is a `DurationLit`, which evaluates to a plain `2000`, and the word is a
 * `DateOffsetLit`, which evaluates to the tagged object `evalBinary` needs to add to a date. Every
 * numeric consumer had only ever met the first, so `expect duration is less than 2 seconds` checked
 * clean and failed every run with ``\`is less than\` expects a number, got object`` — a type error
 * the checker could see and the author met at run time.
 *
 * Exported as a *named* unwrap rather than by loosening either numeric guard, because both guards
 * are load-bearing: `matcher.ts`'s `num()` is `B3-04`'s fix for `expect body.total is less than 100`
 * reporting PASS against `null`, and re-opening it to objects is how that returns. */
export function dateOffsetMs(v: unknown): number | null {
  return isDateOffset(v) ? v.ms : null;
}

function evalBinary(op: BinaryOp, l: unknown, r: unknown): unknown {
  if (l instanceof Date && isDateOffset(r)) {
    if (op === '+') return new Date(l.getTime() + r.ms);
    if (op === '-') return new Date(l.getTime() - r.ms);
    throw new RuntimeError(`cannot apply '${op}' between a date and a duration — only + and - are supported`);
  }
  if (isDateOffset(l) && r instanceof Date && op === '+') return new Date(r.getTime() + l.ms);
  if (typeof l === 'number' && typeof r === 'number') {
    switch (op) {
      case '+':
        return l + r;
      case '-':
        return l - r;
      case '*':
        return l * r;
      case '/':
        if (r === 0) throw new RuntimeError('division by zero');
        return l / r;
    }
  }
  throw new RuntimeError(`cannot apply '${op}' to ${describe(l)} and ${describe(r)}`);
}

function offsetToMs(amount: number, unit: DateOffsetUnit): number {
  switch (unit) {
    case 'seconds':
      return amount * 1000;
    case 'minutes':
      return amount * 60_000;
    case 'hours':
      return amount * 3_600_000;
    case 'days':
      return amount * 86_400_000;
    case 'weeks':
      return amount * 7 * 86_400_000;
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatDate(date: Date, pattern: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'yyyy':
        return String(date.getFullYear());
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'dd':
        return pad(date.getDate());
      case 'HH':
        return pad(date.getHours());
      case 'mm':
        return pad(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      default:
        return token;
    }
  });
}

function asNumber(v: unknown, ctx: string): number {
  const offset = dateOffsetMs(v);
  if (offset !== null) return offset;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) throw new RuntimeError(`\`${ctx}\` expects a number, got ${describe(v)}`);
  return n;
}

function asDate(v: unknown): Date {
  if (v instanceof Date) return v;
  throw new RuntimeError(`expected a date (today/now, optionally with a date-math offset), got ${describe(v)}`);
}

// ---- generators (P#19, P#21–22) --------------------------------------------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
// Deliberately excludes quote/backslash characters so a generated password never needs escaping
// inside a JSON body literal or a URL (decision 98).
const SYMBOLS = '!@#$%^&*-_=+';

/** `#` → random digit, `?` → random uppercase letter, anything else passes through literally. */
function renderLikePattern(pattern: string, rng: () => number): string {
  let out = '';
  for (const ch of pattern) {
    if (ch === '#') out += String(Math.floor(rng() * 10));
    else if (ch === '?') out += LETTERS[Math.floor(rng() * LETTERS.length)];
    else out += ch;
  }
  return out;
}

function randomAlnum(len: number, rng: () => number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALNUM[Math.floor(rng() * ALNUM.length)];
  return out;
}

/** Always includes at least one upper/lower/digit/symbol, then fills the rest from the combined
 * pool and shuffles — so the guaranteed characters aren't always in the first 4 positions
 * (decision 98). Draws from the caller's `rng`, so `--seed` replay covers it like every other
 * `random` generator. */
function randomPassword(length: number, rng: () => number): string {
  const pools = [LETTERS, LOWER, DIGITS, SYMBOLS];
  const all = LETTERS + LOWER + DIGITS + SYMBOLS;
  const chars = pools.map((pool) => pool[Math.floor(rng() * pool.length)]!);
  for (let i = chars.length; i < length; i++) chars.push(all[Math.floor(rng() * all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join('');
}

/** 16 bytes → the standard `8-4-4-4-12` hex grouping. Caller is responsible for setting the
 * version (byte 6's high nibble) and variant (byte 8's top two bits) before calling this. */
function formatUuidBytes(bytes: readonly number[]): string {
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `random uuid` — a plain v4 UUID, collisions allowed (decision 98). */
function randomUuidV4(rng: () => number): string {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(rng() * 256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xxxxxx
  return formatUuidBytes(bytes);
}

/** `unique like "ORD-######"` — the run-wide monotonic counter rendered straight into the pattern's
 * placeholders in mixed radix (`#` = base 10, `?` = base 26 over `LETTERS`), most-significant
 * placeholder first, after passing through an affine permutation of the pattern's own value space
 * so that consecutive draws do not read as a counter.
 *
 * The permutation is keyed by THE PATTERN ALONE and not by the run seed, which makes this a pure
 * function of the counter like every other member of the family: `unique number` answers 8, 9, 10
 * on every run at every seed, and this now answers the same three codes beside it. Keying it on
 * `runSeed` as well was tried first and reverted — the permutation exists only so a draw does not
 * read as a sequence, the pattern keys that completely, and the seed bought nothing the construct
 * promises while making one member of a family move under `--seed` when the other four do not.
 * Cross-*run* collision safety is not on offer here for any of them (§7.2: distinct across
 * tests/workers *within a run*), so seeding did not buy that either.
 *
 * DISTINCTNESS IS A TRUE GUARANTEE, the same kind `unique uuid` gets from embedding the counter and
 * `unique("prefix")` gets from string concatenation (SPEC §7.2, §7.5): `c → (mul·c + add) mod
 * capacity` with `gcd(mul, capacity) = 1` is a bijection on `[0, capacity)`, so distinct counters
 * can only produce distinct codes, and distinct codes render as distinct strings. It is
 * deliberately NOT unpredictable — the values are an arithmetic progression modulo `capacity`, so a
 * reader who has seen two of them can extrapolate the rest. `unique` promises collision-safety, not
 * secrecy, and nothing should treat one of these as a token.
 *
 * `M154g-07` — this used to build a local RNG from `mulberry32(subSeed(runSeed, counter))` and fill
 * the pattern from it, which consumed the counter as a *seed* and then discarded it. That left
 * `unique like` the one member of the family whose distinctness was probabilistic while §7.2
 * promised the family was guaranteed: ten draws of `ORD-##` measured on `fedora-box` at `--seed
 * 4242` produced `ORD-85` three times. It also put the counter into `subSeed`'s *other* namespace —
 * `subSeed(runSeed, testIndex)` is how a test's own `rng` is keyed — so `unique like`'s k-th draw
 * rendered test k's `random` stream verbatim (`M154g-15`). Neither hazard can arise here: no RNG is
 * consulted at all beyond the two constants below, which depend on the pattern alone, never on the
 * counter and never on the run seed.
 *
 * Capacity is finite and the counter is shared with the rest of the `unique` family, so a narrow
 * pattern can genuinely run out. That throws, naming both numbers — silently wrapping would put the
 * false guarantee straight back, which is the whole of this fix. */
function uniqueLike(pattern: string, counter: number): string {
  const chars = [...pattern];
  const slots: number[] = [];
  let capacity = 1n;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch !== '#' && ch !== '?') continue;
    slots.push(i);
    capacity *= ch === '#' ? 10n : 26n;
  }
  if (BigInt(counter) >= capacity) {
    throw new RuntimeError(
      `unique like ${JSON.stringify(pattern)} can encode at most ${capacity} distinct value${capacity === 1n ? '' : 's'}, ` +
        `and this run's \`unique\` counter has already reached ${counter} (it is shared with every other \`unique\` ` +
        `generator, SPEC §7.5). Widen the pattern, or use \`random like\` if collisions are acceptable.`,
    );
  }
  let code = permuteIndex(BigInt(counter), capacity, pattern);
  for (let k = slots.length - 1; k >= 0; k--) {
    const i = slots[k]!;
    const radix = chars[i] === '#' ? 10n : 26n;
    const digit = Number(code % radix);
    code /= radix;
    chars[i] = radix === 10n ? String(digit) : LETTERS[digit]!;
  }
  return chars.join('');
}

/** The bijection `uniqueLike` renders. `mul` is drawn from a per-pattern sub-seed and then walked up
 * to the first value coprime with `capacity`, which always terminates: `capacity` is a product of
 * 10s and 26s, so its prime factors are a subset of {2, 5, 13} and coprime values are dense. The
 * only key is the pattern, so two patterns of the same shape do not walk their value spaces in
 * lockstep while one pattern walks its own identically on every run — `--seed` replay reproduces
 * the draw (P#23) because nothing here varies with the seed at all.
 *
 * `BigInt` throughout, not `number`: a 16-`#` pattern's capacity is already past
 * `Number.MAX_SAFE_INTEGER`, and `index * mul` overflows the double's exact range long before that.
 * A float rounding here would silently map two counters onto one code — which is precisely the
 * guarantee this function exists to make true, so it cannot be left to a size assumption about how
 * wide a pattern anyone writes. */
function permuteIndex(index: bigint, capacity: bigint, pattern: string): bigint {
  if (capacity <= 2n) return index; // a 1- or 2-element space has no scrambling to do
  const rng = mulberry32(subSeed(hashString(pattern) >>> 0, 0x11c5));
  // `rng()` is a double in [0,1); scaled through `Number` first, then widened — capacity can exceed
  // 2^53, so the draw lands in a coarse but well-spread subset of a huge space rather than pretending
  // to a precision `mulberry32` does not have. Bijectivity depends on `gcd`, not on this spread.
  const pick = (bound: bigint): bigint => (BigInt(Math.floor(rng() * 0x1_0000_0000)) * bound) / 0x1_0000_0000n;
  let mul = pick(capacity - 1n) + 1n;
  while (gcdBig(mul, capacity) !== 1n) mul = (mul % (capacity - 1n)) + 1n;
  const add = pick(capacity);
  return (index * mul + add) % capacity;
}

function gcdBig(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** `unique uuid` — v4-shaped, but the trailing 4 bytes (last 8 hex digits) are the run-wide
 * monotonic counter itself, not random: since that counter never repeats within a run, this is a
 * true distinctness guarantee (mirroring how `UniquePrefixExpr` guarantees it via literal string
 * concatenation), not just v4's low collision probability. The first 12 bytes come from a local
 * RNG keyed off the same counter (same pattern `UniqueLikeExpr` uses) purely for a realistic
 * random-looking shape — they carry none of the uniqueness guarantee themselves. */
function uniqueUuid(counter: number, runSeed: number): string {
  // `SEED_DOMAIN.uniqueUuid` (`M154g-15`, `D815`): without it this passed the `unique` counter into
  // the same argument position `interpreter.ts` fills with a *test index*, so `unique uuid`'s k-th
  // draw shaped itself from test k's `random` stream. The trailing 8 hex digits — where the actual
  // distinctness guarantee lives — are the counter itself and are untouched by this.
  const localRng = mulberry32(subSeed(runSeed, counter, SEED_DOMAIN.uniqueUuid));
  const bytes: number[] = [];
  for (let i = 0; i < 12; i++) bytes.push(Math.floor(localRng() * 256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xxxxxx
  const counterHex = (counter >>> 0).toString(16).padStart(8, '0');
  for (let i = 0; i < 4; i++) bytes.push(parseInt(counterHex.slice(i * 2, i * 2 + 2), 16));
  return formatUuidBytes(bytes);
}

// ---- transforms: base64 / hex / url encode/decode (decision 98) -----------

// The shape tests come from `@tflw/lang` (M124, D233) — `TF054` predicts these three throws, and a
// second copy of "what counts as valid hex" is exactly the drift that would make the prediction
// wrong on the inputs users actually hit. The *messages* stay here, where they fire.
function applyTransform(kind: 'base64' | 'hex' | 'url', direction: 'encode' | 'decode', input: string): string {
  if (kind === 'url') {
    if (direction === 'encode') return encodeURIComponent(input);
    if (!isDecodablePercentEncoding(input)) {
      throw new RuntimeError(`url decode(...): "${input}" is not validly percent-encoded`);
    }
    return decodeURIComponent(input);
  }
  if (direction === 'encode') return Buffer.from(input, 'utf8').toString(kind);
  // `Buffer.from(..., 'hex'|'base64')` silently ignores invalid characters instead of throwing,
  // so malformed input must be rejected with an explicit shape check before decoding.
  if (kind === 'hex' && !isDecodableHex(input)) {
    throw new RuntimeError(`hex decode(...): "${input}" is not valid hex`);
  }
  if (kind === 'base64' && !isDecodableBase64(input)) {
    throw new RuntimeError(`base64 decode(...): "${input}" is not valid base64`);
  }
  return Buffer.from(input, kind).toString('utf8');
}
