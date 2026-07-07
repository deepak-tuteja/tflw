// Evaluate AST values against a running scope: string interpolation, `env(…)` secrets (which
// register for redaction), variable/capture references, JSON body shapes, arithmetic/date-math
// expressions, and the `unique`/`random` generator family (M2, SPEC §7).

import { parseStringParts, type BinaryOp, type DateOffsetUnit, type PathSegment, type StringPart, type Value } from '@tflw/lang';
import type { Redactor } from './redact.js';
import { subSeed, mulberry32 } from './seed.js';
import type { CookieJar } from './cookieJar.js';

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
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
  /** Present only while executing a `session` block's own steps: a `HeaderStmt` writes into this
   * instead of the (nonexistent) response/report subject it would otherwise need (P#42). */
  readonly headerSink?: Record<string, string>;
  /** Cookies accumulated from every response seen so far in this scope (a `session` block's own
   * run, or one test's own attempt — including any `before`/`after` hooks and action calls sharing
   * that same attempt) — automatically attached to subsequent requests as a `Cookie` header,
   * automatically updated from every response's `Set-Cookie` (SPEC §3.3, P#33). A test opting into
   * `as <session>` starts with a *clone* of that session's own jar (§3.3) so its mutations never
   * leak back into the shared session cache or a concurrently-running sibling test. */
  readonly cookieJar: CookieJar;
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
      return formatDate(v, value.pattern.value);
    }
    case 'UniquePrefixExpr': {
      const prefix = String(evalValue(value.prefix, ctx));
      return `${prefix}-${ctx.uniqueSeq.next()}`;
    }
    case 'UniqueEmailExpr':
      return `user${ctx.uniqueSeq.next()}@example.test`;
    case 'UniqueNumberExpr':
      return ctx.uniqueSeq.next();
    case 'UniqueLikeExpr': {
      // Random-looking but guaranteed distinct: each call gets its own local RNG keyed off the
      // monotonic counter, not the shared per-test `rng` stream (P#19, P#22).
      const localRng = mulberry32(subSeed(ctx.runSeed, ctx.uniqueSeq.next()));
      return renderLikePattern(value.pattern.value, localRng);
    }
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
      return new Date(from.getTime() + ctx.rng() * (to.getTime() - from.getTime()));
    }
    case 'RandomOfExpr': {
      const idx = Math.floor(ctx.rng() * value.choices.length);
      return evalValue(value.choices[idx]!, ctx);
    }
    case 'RandomStringExpr': {
      const len = asNumber(evalValue(value.length, ctx), 'random string');
      return randomAlnum(len, ctx.rng);
    }
    case 'RandomLikeExpr':
      return renderLikePattern(value.pattern.value, ctx.rng);
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

function resolveRef(ref: readonly PathSegment[], ctx: EvalCtx): unknown {
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
