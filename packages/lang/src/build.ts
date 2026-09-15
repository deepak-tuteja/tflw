// Form values → AST nodes — `M200` `A0-4` (`D1046`).
//
// The printer's input. A form holds numbers and words; `print` needs a node; these build one.
// They exist rather than letting the page write AST literals for two reasons. Every node carries
// a `span` it has no business inventing at each call site, and — the load-bearing one — **the
// parser refuses things a form can produce**, so a builder is where a refusal can be phrased in
// the form's own words instead of arriving later as a `422` from a write route about text the
// author never saw.
//
// The spans are `SYNTHETIC`. A node built here has never been in a file, which is the whole case
// for a printer (`D994`: "a printer is needed only to *insert* a node with no span"). `print`
// reads no spans at all, and `insertIntoSource` re-parses the formatted result, so the position
// a node is eventually diagnosed at is the one it really lands on.
import type { Position, Span } from './token.js';
import type { Stage, StringLit, TestDecl, ThresholdDecl, ThresholdMetric, ThresholdOp, Workload } from './ast.js';

const ORIGIN: Position = { line: 1, column: 1, offset: 0 };
/** Every node built here carries this. It says "not from a file" rather than pretending to a
 *  position, which a zero-width span at the origin is the honest spelling of. */
export const SYNTHETIC: Span = { start: ORIGIN, end: ORIGIN };

export type BuildResult<T> = { readonly ok: true; readonly node: T } | { readonly ok: false; readonly reason: string };

const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** A plain string literal with no interpolation. Interpolated text is `A1`'s: a form field that
 *  accepts `{orderId}` has to resolve it against what is in scope, which is a different feature. */
export function stringLit(value: string): StringLit {
  return { type: 'StringLit', value, parts: [{ kind: 'text', value }], span: SYNTHETIC };
}

export interface StageSpec {
  readonly mode: 'jump' | 'ramp';
  readonly target: number;
  readonly durationMs: number;
}

export type WorkloadSpec =
  | { readonly kind: 'ramp'; readonly unit: 'users' | 'rps'; readonly target: number; readonly overMs: number }
  | { readonly kind: 'hold'; readonly unit: 'users' | 'rps'; readonly target: number; readonly forMs: number }
  | { readonly kind: 'step' | 'spike'; readonly unit: 'users' | 'rps'; readonly stages: readonly StageSpec[] }
  | { readonly kind: 'iterations'; readonly perUser: boolean; readonly count: number; readonly vus: number };

/**
 * The five workload shapes, as a form offers them.
 *
 * Every bound the parser enforces is enforced here, in the form's words rather than the parser's:
 * a positive target (`LOAD_INVALID`, `parser.ts:1323`), a positive duration, at least one stage
 * in a `step`/`spike` block, and — the one that is not a parser rule — **no ramped stage inside a
 * `step`**, because a `step` block has no spelling for one (`print.ts`'s `CONTEXT_BOUND`) and the
 * form would otherwise build a node nothing can write down.
 */
export function buildWorkload(spec: WorkloadSpec): BuildResult<Workload> {
  switch (spec.kind) {
    case 'ramp': {
      const e = positive(spec.target, 'a target') ?? duration(spec.overMs, 'the ramp');
      if (e) return bad(e);
      return spec.unit === 'users'
        ? { ok: true, node: { type: 'RampUsersWorkload', users: spec.target, overMs: spec.overMs, span: SYNTHETIC } }
        : { ok: true, node: { type: 'RampRpsWorkload', rps: spec.target, overMs: spec.overMs, span: SYNTHETIC } };
    }
    case 'hold': {
      const e = positive(spec.target, 'a target') ?? duration(spec.forMs, 'the hold');
      if (e) return bad(e);
      return spec.unit === 'users'
        ? { ok: true, node: { type: 'HoldUsersWorkload', users: spec.target, forMs: spec.forMs, span: SYNTHETIC } }
        : { ok: true, node: { type: 'HoldRpsWorkload', rps: spec.target, forMs: spec.forMs, span: SYNTHETIC } };
    }
    case 'step':
    case 'spike': {
      if (spec.stages.length === 0) return bad(`a \`${spec.kind}\` needs at least one stage`);
      const stages: Stage[] = [];
      for (const [i, s] of spec.stages.entries()) {
        const e = positive(s.target, `stage ${i + 1}'s target`) ?? duration(s.durationMs, `stage ${i + 1}`);
        if (e) return bad(e);
        if (spec.kind === 'step' && s.mode === 'ramp') {
          return bad(`a \`step\` block has no way to write a ramped stage — every stage jumps to its level. Use \`spike\` for a ramp.`);
        }
        stages.push({ type: 'Stage', mode: s.mode, target: s.target, durationMs: s.durationMs, span: SYNTHETIC });
      }
      const type = `${spec.kind === 'step' ? 'Step' : 'Spike'}${spec.unit === 'users' ? 'Users' : 'Rps'}Workload` as
        | 'StepUsersWorkload' | 'StepRpsWorkload' | 'SpikeUsersWorkload' | 'SpikeRpsWorkload';
      return { ok: true, node: { type, stages, span: SYNTHETIC } };
    }
    case 'iterations': {
      const e = positive(spec.count, 'an iteration count') ?? positive(spec.vus, 'a user count');
      if (e) return bad(e);
      return spec.perUser
        ? { ok: true, node: { type: 'PerVuIterationsWorkload', iterationsPerVu: spec.count, vus: spec.vus, span: SYNTHETIC } }
        : { ok: true, node: { type: 'SharedIterationsWorkload', iterations: spec.count, vus: spec.vus, span: SYNTHETIC } };
    }
  }
}

export interface ThresholdSpec {
  readonly metric: ThresholdMetric;
  readonly op: ThresholdOp;
  /** Milliseconds for a `duration` metric; a **percentage** for `errorRate` — the number the
   *  author types beside the `%`, not the fraction the AST stores. The conversion is here so the
   *  form never has to know that `1%` is `0.01` on the inside. */
  readonly bound: number;
  readonly scope: string | null;
}

export function buildThreshold(spec: ThresholdSpec): BuildResult<ThresholdDecl> {
  if (!Number.isFinite(spec.bound) || spec.bound < 0) return bad('a threshold needs a bound of zero or more');
  if (spec.metric.kind === 'duration') {
    if (!Number.isInteger(spec.metric.percentile) || spec.metric.percentile < 1 || spec.metric.percentile > 99) {
      return bad('a percentile is p1 to p99');
    }
  } else if (spec.bound > 100) {
    return bad('an error-rate bound is a percentage, so it cannot exceed 100');
  }
  const value = spec.metric.kind === 'duration' ? spec.bound : spec.bound / 100;
  return { ok: true, node: { type: 'ThresholdDecl', metric: spec.metric, op: spec.op, value, scope: spec.scope === null ? null : stringLit(spec.scope), span: SYNTHETIC } };
}

export interface TestSpec {
  readonly name: string;
  readonly tags: readonly string[];
  readonly workload: Workload | null;
  readonly thresholds: readonly ThresholdDecl[];
  readonly body: TestDecl['body'];
}

/** A whole `test`, with the fields a form does not offer left at the parser's own defaults —
 *  `retry 0`, `sequential`, no sessions, no table. A form that grows one of those sets it here. */
export function buildTest(spec: TestSpec): BuildResult<TestDecl> {
  if (spec.name.trim().length === 0) return bad('a test needs a name');
  for (const tag of spec.tags) {
    if (!/^[A-Za-z][\w-]*$/.test(tag)) return bad(`\`@${tag}\` is not a tag — a tag starts with a letter and holds letters, digits, \`_\` or \`-\``);
  }
  return {
    ok: true,
    node: {
      type: 'TestDecl',
      name: stringLit(spec.name),
      tags: spec.tags,
      sessions: [],
      retry: 0,
      table: null,
      workload: spec.workload,
      thresholds: spec.thresholds,
      concurrency: 'sequential',
      body: spec.body,
      span: SYNTHETIC,
    },
  };
}

function positive(n: number, what: string): string | null {
  if (!Number.isFinite(n)) return `${what} must be a number`;
  if (!Number.isInteger(n)) return `${what} must be a whole number`;
  return n > 0 ? null : `${what} must be greater than zero`;
}

function duration(ms: number, what: string): string | null {
  if (!Number.isFinite(ms)) return `${what} needs a duration`;
  if (!Number.isInteger(ms)) return `${what}'s duration must be a whole number of milliseconds`;
  return ms > 0 ? null : `${what} must last longer than zero`;
}
