// The reuse pass (M6, P#2): "the compiler detects similar step sequences across tests and reports
// them as diagnostics with a fully prepared extraction (proposed `action` name, params, call-site
// diff). Applied only explicitly: `tflw refactor apply <id>` or an IDE code action. Builds never
// mutate source."
//
// v1 scope (a deliberate, documented cut — not the full ambition of P#2):
//   - Only `TestDecl.body` top-level step sequences are scanned (not `action`/`before`/`after`
//     bodies) — matches testFlow-tests' own M4 framing ("deliberately duplicated *tests*").
//   - A candidate window may only contain "flat" steps that neither introduce a binding
//     (`LetStmt`/`CaptureStmt`) nor carry a nested step block (`WithinBlock`, `SwitchToNewTabBlock`,
//     `DownloadBlock`, `FillFormStmt`, `WaitUntilApiStmt`, `WaitUntilUiStmt`, `GiveStmt`,
//     `HeaderStmt`) — see `ELIGIBLE_STEP_TYPES`. This means an extracted action never needs a
//     `give`: every call site is a bare `CallStmt` (M6's other half), and no escape-analysis of
//     bindings across the extraction boundary is required. Real login/setup/teardown flows (the
//     common duplication shape) are exactly this: open → fill → fill → click → expect.
//   - Only literals sitting in a genuinely `Value`-typed AST position (`FillStmt.value`,
//     `Matcher.value`, an object-literal field's value, a call argument, …) are parameterizable —
//     never a strictly-`StringLit`/`NumberLit`-typed field (`Locator.value`, `OpenStmt.path`,
//     `StubStmt.status`, …), because there is no `{ref}`-interpolation-shaped hole to put a
//     parameter into at that grammar position without losing exactness. Those fields must be
//     byte-identical across every occurrence for a window to match at all — see `maskValue` vs. the
//     structural (non-masking) fields spelled out per step type in `analyzeStep`.
//   - Matching is greedy, longest-window-first, non-overlapping (`detectReuse`) — not a full
//     suite-wide longest-common-subsequence search. Simpler, deterministic, and good enough to find
//     the obviously-duplicated flows this pass targets; a smarter search is a future extension, not
//     a v1 requirement.

import type { GeneratorExpr, Program, Step, TestDecl, Value } from './ast.js';
import { STATEMENT_KEYWORDS } from './parser.js';
import type { Span } from './token.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One file's already-parsed contents, as `tflw check`/`tflw refactor apply` already have them
 * lying around in `ValidatedProject.parsedFiles` — reuse detection never reads from disk itself. */
export interface SuiteEntry {
  /** Display/lookup path — whatever the caller wants echoed back in a `ReuseOccurrence` (the CLI
   * passes a cwd-relative path; `tflw refactor apply` also needs the caller to keep its own map
   * back to the real absolute file path for writing). */
  readonly path: string;
  readonly source: string;
  readonly program: Program;
}

export interface ReuseOccurrence {
  readonly path: string;
  readonly testName: string;
  /** 1-based, inclusive — the first and last matched step's source lines. */
  readonly startLine: number;
  readonly endLine: number;
  /** Covers the exact first-step-start .. last-step-end range (multi-line steps included) —
   * `renderCallSiteReplacement` widens this to whole lines before splicing. */
  readonly span: Span;
  /** This occurrence's own literal text for each of the cluster's `params`, in param order —
   * already the *original* source text (quotes/escaping intact, not re-serialized). */
  readonly args: readonly string[];
}

export interface ReuseHint {
  /** Stable within one scan (`RF001`, `RF002`, …) — sorted by first occurrence (path, line), not a
   * content hash (same tradeoff `TF0xx` codes already make: stable *within a compile*, not across
   * arbitrary unrelated edits elsewhere in the suite). */
  readonly id: string;
  /** Steps per occurrence. */
  readonly length: number;
  readonly occurrences: readonly ReuseOccurrence[];
  /** Space-separated words, e.g. `"log in"` — same multi-word-call convention `action` names
   * already use (`create order(...)`). */
  readonly actionName: string;
  /** camelCase, e.g. `["username", "password"]` — empty when every occurrence is byte-identical. */
  readonly params: readonly string[];
  /** `shared/log-in.tflw` — cwd-relative, POSIX separators, always under `shared/`. */
  readonly actionFile: string;
  /** The full `action …` declaration to write into `actionFile` (occurrence 0's own steps as the
   * template, differing literals replaced by `{param}` interpolation, everything else copied
   * byte-for-byte from source). */
  readonly actionSource: string;
  /** Human-readable text block for `tflw check`'s output — occurrences, proposed action, and a
   * before/after call-site preview. */
  readonly diffPreview: string;
}

// ---------------------------------------------------------------------------
// Step eligibility + structural "shape" (masks parameterizable literals)
// ---------------------------------------------------------------------------

interface LiteralRef {
  /** Original source span of the literal (StringLit/NumberLit/BoolLit) being masked. */
  readonly span: Span;
  /** Best-effort name hint for the eventual param (e.g. the field/locator name it sits next to). */
  readonly hint: string;
}

/** Mutable accumulator threaded through one step's analysis — every masked literal is pushed here
 * in traversal order, matching the `{p: index}` placeholders left in the returned shape. */
type Literals = LiteralRef[];

function maskValue(v: Value, literals: Literals, hint: string): unknown {
  switch (v.type) {
    case 'StringLit':
    case 'NumberLit':
    case 'BoolLit':
      literals.push({ span: v.span, hint });
      return { p: literals.length - 1 };
    case 'NullLit':
      return { t: 'NullLit' };
    case 'DurationLit':
      return { t: 'DurationLit', ms: v.ms };
    case 'VarRef':
      return { t: 'VarRef', name: v.name };
    case 'Interp':
      return { t: 'Interp', ref: v.ref };
    case 'EnvRef':
      return { t: 'EnvRef', name: v.name };
    case 'ObjectLit':
      return { t: 'ObjectLit', fields: v.fields.map((f) => ({ key: f.key, value: maskValue(f.value, literals, f.key) })) };
    case 'ArrayLit':
      return { t: 'ArrayLit', elements: v.elements.map((e) => maskValue(e, literals, hint)) };
    case 'BinaryExpr':
      return { t: 'BinaryExpr', op: v.op, left: maskValue(v.left, literals, hint), right: maskValue(v.right, literals, hint) };
    case 'DateAtom':
      return { t: 'DateAtom', which: v.which };
    case 'DateOffsetLit':
      return { t: 'DateOffsetLit', amount: v.amount, unit: v.unit };
    case 'FormatExpr':
      return { t: 'FormatExpr', value: maskValue(v.value, literals, hint), pattern: v.pattern.value };
    case 'TransformExpr':
      return { t: 'TransformExpr', kind: v.kind, direction: v.direction, value: maskValue(v.value, literals, hint) };
    case 'CallExpr':
      return { t: 'CallExpr', name: v.name, args: v.args.map((a) => maskValue(a, literals, hint)) };
    default:
      return maskGenerator(v, literals, hint);
  }
}

function maskGenerator(v: GeneratorExpr, literals: Literals, hint: string): unknown {
  switch (v.type) {
    case 'UniquePrefixExpr':
      return { t: v.type, prefix: maskValue(v.prefix, literals, hint) };
    case 'UniqueEmailExpr':
    case 'UniqueNumberExpr':
    case 'UniqueUuidExpr':
    case 'RandomDateInPastExpr':
    case 'RandomDateInFutureExpr':
    case 'RandomUuidExpr':
      return { t: v.type };
    case 'UniqueLikeExpr':
      return { t: v.type, pattern: v.pattern.value };
    case 'RandomNumberExpr':
    case 'RandomDecimalExpr':
    case 'RandomDateBetweenExpr':
      return { t: v.type, from: maskValue(v.from, literals, hint), to: maskValue(v.to, literals, hint) };
    case 'RandomOfExpr':
      return { t: v.type, choices: v.choices.map((c) => maskValue(c, literals, hint)) };
    case 'RandomStringExpr':
      return { t: v.type, length: maskValue(v.length, literals, hint) };
    case 'RandomLikeExpr':
      return { t: v.type, pattern: v.pattern.value };
    case 'RandomPasswordExpr':
      return { t: v.type, length: v.length ? maskValue(v.length, literals, hint) : null };
  }
}

/** A `Locator` never has a parameterizable literal (D6/D7 name resolution has to stay exact) —
 * always structural, kind + text verbatim. */
function locatorShape(loc: { readonly kind: string; readonly value: { readonly value: string } }): unknown {
  return { kind: loc.kind, name: loc.value.value };
}

function netRefShape(ref: { readonly urlPattern: { readonly value: string }; readonly method: { readonly value: string } | null } | null): unknown {
  return ref ? { urlPattern: ref.urlPattern.value, method: ref.method?.value ?? null } : null;
}

const CALL_HINT = 'value';

/** The step types a candidate window may contain — see the module doc comment's v1-scope note.
 * Anything else (bindings, nested blocks) makes a window ineligible wherever it appears. */
const ELIGIBLE_STEP_TYPES: ReadonlySet<Step['type']> = new Set([
  'ApiStep',
  'ExpectStmt',
  'CallStmt',
  'OpenStmt',
  'ClickStmt',
  'FillStmt',
  'SelectStmt',
  'TickStmt',
  'UntickStmt',
  'PressStmt',
  'HoverStmt',
  'ScrollStmt',
  'AcceptDialogStmt',
  'DismissDialogStmt',
  'SwitchToTabStmt',
  'CloseTabStmt',
  'DragStmt',
  'DropFileStmt',
  'ScreenshotStmt',
  'StubStmt',
]);

interface StepAnalysis {
  readonly shape: unknown;
  readonly literals: Literals;
}

/** True if any string leaf of a step's structural shape carries a `{name}`-shaped interpolation.
 * These fields (`OpenStmt.path`, a `Locator`'s own name/text, `DropFileStmt.filePath`, a `stub`'s
 * `urlPattern`, …) are deliberately copied through `analyzeStep` as opaque, byte-identical text —
 * never routed through `maskValue`'s genuine `Interp` case (SPEC's `{ref}`-interpolation only
 * exists as a distinct AST node inside a `Value`-typed position; a raw string field like
 * `OpenStmt.path` just stores `"/products/{bulk100Id}"` verbatim, `{bulk100Id}` and all). Two
 * occurrences can still be byte-identical text (e.g. two tests that both happen to `capture … as
 * bulk100Id` before opening it) and cluster into a hint — but the variable only exists in each
 * *caller's* own scope, never inside the extracted action's, so the generated action is broken on
 * its very first run (M7 acceptance: found via a real `tflw refactor apply` against
 * testFlow-tests' webv2-storefront.tflw, whose extracted action's `open "/products/{bulk100Id}"`
 * step referenced a variable nothing inside the action itself ever bound). Excluding any step
 * with this shape from matching entirely is conservative but correct — v1 has no mechanism to
 * turn a free reference like this into a real action parameter (`OpenStmt.path` is one of the
 * StringLit-strict fields the module doc above already excludes from `maskValue` parameterization
 * for a different reason — exactness — and reusing that same non-parameterizable status here). */
function hasFreeInterpolation(shape: unknown): boolean {
  if (typeof shape === 'string') return /\{[A-Za-z_][A-Za-z0-9_]*\}/.test(shape);
  if (Array.isArray(shape)) return shape.some(hasFreeInterpolation);
  if (shape && typeof shape === 'object') return Object.values(shape).some(hasFreeInterpolation);
  return false;
}

/** Structural shape (JSON-stable-stringified by the caller) plus every masked literal, in
 * traversal order. Returns `null` for an ineligible step type. */
function analyzeStep(step: Step): StepAnalysis | null {
  if (!ELIGIBLE_STEP_TYPES.has(step.type)) return null;
  const literals: Literals = [];
  const analysis = analyzeEligibleStep(step, literals);
  return analysis && hasFreeInterpolation(analysis.shape) ? null : analysis;
}

function analyzeEligibleStep(step: Step, literals: Literals): StepAnalysis | null {
  switch (step.type) {
    case 'ApiStep': {
      const body = step.body;
      const bodyShape =
        body === null
          ? null
          : body.type === 'InlineBody'
            ? { t: 'InlineBody', fields: body.object.fields.map((f) => ({ key: f.key, value: maskValue(f.value, literals, f.key) })) }
            : body.type === 'FormBody'
              ? { t: 'FormBody', fields: body.fields.map((f) => ({ key: f.key, value: maskValue(f.value, literals, f.key) })) }
              : body.type === 'FileBody'
                ? { t: 'FileBody', path: body.path.value }
                : body.type === 'TextBody'
                  ? { t: 'TextBody', value: body.value.value }
                  : {
                      t: 'UploadBody',
                      filePath: body.filePath.value,
                      fieldName: body.fieldName.value,
                      contentType: body.contentType?.value ?? null,
                      extra: body.extra.map((f) => ({ key: f.key, value: maskValue(f.value, literals, f.key) })),
                    };
      return {
        shape: {
          t: 'ApiStep',
          service: step.service,
          method: step.method,
          path: step.path.raw,
          body: bodyShape,
          headers: step.headers.map((h) => ({ name: h.name.value, value: maskValue(h.value, literals, h.name.value) })),
          timeoutMs: step.timeoutMs,
          followRedirects: step.followRedirects,
          retryMax: step.retryAfter?.max ?? null,
        },
        literals,
      };
    }
    case 'ExpectStmt': {
      const subj = step.subject;
      const subjectShape =
        subj.type === 'LocatorSubject'
          ? { t: subj.type, locator: locatorShape(subj.locator) }
          : subj.type === 'HeaderSubject'
            ? { t: subj.type, name: subj.name.value, of: netRefShape(subj.of) }
            : subj.type === 'BodySubject'
              ? { t: subj.type, path: subj.path, of: netRefShape(subj.of) }
              : subj.type === 'BodyCsvSubject'
                ? { t: subj.type, path: subj.path }
                : subj.type === 'StatusSubject'
                  ? { t: subj.type, of: netRefShape(subj.of) }
                  : subj.type === 'BodyTextSubject'
                    ? { t: subj.type, of: netRefShape(subj.of) }
                    : subj.type === 'NetworkRequestSubject'
                      ? { t: subj.type, ref: netRefShape(subj.ref) }
                      : { t: subj.type };
      return {
        shape: {
          t: 'ExpectStmt',
          soft: step.soft,
          quantifier: step.quantifier,
          subject: subjectShape,
          matcher: {
            name: step.matcher.name,
            negated: step.matcher.negated,
            value: step.matcher.value ? maskValue(step.matcher.value, literals, 'value') : null,
            schemaName: step.matcher.schemaName?.value ?? null,
            schemaSource: step.matcher.schemaSource?.value ?? null,
            filePath: step.matcher.filePath?.value ?? null,
            a11ySeverity: step.matcher.a11ySeverity ?? null,
            snapshotName: step.matcher.snapshotName?.value ?? null,
          },
          masks: step.masks.map(locatorShape),
        },
        literals,
      };
    }
    case 'CallStmt':
      return { shape: { t: 'CallStmt', name: step.call.name, args: step.call.args.map((a) => maskValue(a, literals, CALL_HINT)) }, literals };
    case 'OpenStmt':
      return { shape: { t: 'OpenStmt', path: step.path.value }, literals: [] };
    case 'ClickStmt':
      return { shape: { t: 'ClickStmt', kind: step.kind, locator: locatorShape(step.locator) }, literals: [] };
    case 'FillStmt':
      return { shape: { t: 'FillStmt', locator: locatorShape(step.locator), value: maskValue(step.value, literals, step.locator.value.value) }, literals };
    case 'SelectStmt':
      return { shape: { t: 'SelectStmt', locator: locatorShape(step.locator), value: maskValue(step.value, literals, step.locator.value.value) }, literals };
    case 'TickStmt':
      return { shape: { t: 'TickStmt', locator: locatorShape(step.locator) }, literals: [] };
    case 'UntickStmt':
      return { shape: { t: 'UntickStmt', locator: locatorShape(step.locator) }, literals: [] };
    case 'PressStmt':
      return { shape: { t: 'PressStmt', keys: step.keys.value, locator: step.locator ? locatorShape(step.locator) : null }, literals: [] };
    case 'HoverStmt':
      return { shape: { t: 'HoverStmt', locator: locatorShape(step.locator) }, literals: [] };
    case 'ScrollStmt':
      return { shape: { t: 'ScrollStmt', locator: locatorShape(step.locator) }, literals: [] };
    case 'AcceptDialogStmt':
      return { shape: { t: 'AcceptDialogStmt' }, literals: [] };
    case 'DismissDialogStmt':
      return { shape: { t: 'DismissDialogStmt' }, literals: [] };
    case 'SwitchToTabStmt':
      return { shape: { t: 'SwitchToTabStmt', index: step.index }, literals: [] };
    case 'CloseTabStmt':
      return { shape: { t: 'CloseTabStmt' }, literals: [] };
    case 'DragStmt':
      return { shape: { t: 'DragStmt', from: locatorShape(step.from), to: locatorShape(step.to) }, literals: [] };
    case 'DropFileStmt':
      return { shape: { t: 'DropFileStmt', filePath: step.filePath.value, locator: locatorShape(step.locator) }, literals: [] };
    case 'ScreenshotStmt':
      return { shape: { t: 'ScreenshotStmt', name: step.name.value }, literals: [] };
    case 'StubStmt':
      return {
        shape: {
          t: 'StubStmt',
          method: step.method,
          urlPattern: step.urlPattern.value,
          status: step.status.value,
          body: step.body ? step.body.fields.map((f) => ({ key: f.key, value: maskValue(f.value, literals, f.key) })) : null,
        },
        literals,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const MIN_LEN = 3;
const MAX_LEN = 12;

interface TestSlot {
  readonly entry: SuiteEntry;
  readonly test: TestDecl;
  /** Precomputed per-step analysis, `null` for an ineligible step (never joins a window). */
  readonly analyses: readonly (StepAnalysis | null)[];
}

interface WindowOcc {
  readonly slotIdx: number;
  readonly start: number;
}

function stableKey(shapes: readonly unknown[]): string {
  return JSON.stringify(shapes);
}

function windowClaimed(claimed: boolean[][], slotIdx: number, start: number, len: number): boolean {
  for (let i = start; i < start + len; i++) if (claimed[slotIdx]![i]) return true;
  return false;
}

function claimWindow(claimed: boolean[][], slotIdx: number, start: number, len: number): void {
  for (let i = start; i < start + len; i++) claimed[slotIdx]![i] = true;
}

function rangesOverlap(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

/** Detect near-duplicate step sequences across the given suite and propose an extraction for each
 * (P#2). Deterministic for a given input (same files/content in, same hints + ids out). */
export function detectReuse(entries: readonly SuiteEntry[]): ReuseHint[] {
  const slots: TestSlot[] = [];
  for (const entry of entries) {
    for (const test of entry.program.tests) {
      slots.push({ entry, test, analyses: test.body.map((s) => analyzeStep(s)) });
    }
  }

  const claimed: boolean[][] = slots.map((s) => new Array(s.test.body.length).fill(false));
  const longestBody = slots.reduce((m, s) => Math.max(m, s.test.body.length), 0);
  const maxLen = Math.min(MAX_LEN, longestBody);
  const clusters: { readonly length: number; readonly occs: readonly WindowOcc[] }[] = [];

  for (let len = maxLen; len >= MIN_LEN; len--) {
    const buckets = new Map<string, WindowOcc[]>();
    slots.forEach((slot, slotIdx) => {
      const body = slot.test.body;
      for (let start = 0; start + len <= body.length; start++) {
        if (windowClaimed(claimed, slotIdx, start, len)) continue;
        let eligible = true;
        for (let i = start; i < start + len; i++) {
          if (slot.analyses[i] === null) {
            eligible = false;
            break;
          }
        }
        if (!eligible) continue;
        const shapes = slot.analyses.slice(start, start + len).map((a) => a!.shape);
        const key = stableKey(shapes);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push({ slotIdx, start });
      }
    });
    for (const key of [...buckets.keys()].sort()) {
      const occs = buckets.get(key)!;
      if (occs.length < 2) continue;
      // Two *unclaimed* overlapping windows of the same length in the same test can both land in
      // this bucket before either is claimed (the `windowClaimed` check above only excludes
      // windows overlapping an *earlier, already-accepted* cluster). Keep the earliest of any that
      // overlap each other within this cluster.
      const accepted: WindowOcc[] = [];
      for (const occ of occs) {
        const overlapsAccepted = accepted.some((a) => a.slotIdx === occ.slotIdx && rangesOverlap(a.start, len, occ.start, len));
        if (!overlapsAccepted) accepted.push(occ);
      }
      if (accepted.length < 2) continue;
      for (const occ of accepted) claimWindow(claimed, occ.slotIdx, occ.start, len);
      clusters.push({ length: len, occs: accepted });
    }
  }

  const drafts = clusters.map((c) => buildHint(slots, c.length, c.occs));
  drafts.sort((a, b) => {
    const ao = a.occurrences[0]!;
    const bo = b.occurrences[0]!;
    return ao.path === bo.path ? ao.startLine - bo.startLine : ao.path.localeCompare(bo.path);
  });

  const usedNames = new Set<string>();
  return drafts.map((draft, i) => finalizeHint(`RF${String(i + 1).padStart(3, '0')}`, dedupeName(draft.actionName, usedNames), draft));
}

function dedupeName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  const name = `${base} ${n}`;
  used.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// Building a hint from a cluster of matching windows
// ---------------------------------------------------------------------------

interface DraftHint {
  readonly length: number;
  readonly occurrences: readonly ReuseOccurrence[];
  readonly actionName: string;
  readonly params: readonly string[];
  /** occurrence 0's own steps + owning entry — the render template. */
  readonly templateEntry: SuiteEntry;
  readonly templateSteps: readonly Step[];
  /** Parallel to `templateSteps`: per step, per literal (in `analyzeStep` traversal order), the
   * param name it became, or `null` if this slot was identical across every occurrence (so it
   * stays a literal in the extracted action). */
  readonly templateParamNames: readonly (readonly (string | null)[])[];
}

function buildHint(slots: readonly TestSlot[], length: number, occs: readonly WindowOcc[]): DraftHint {
  const stepsOf = (occ: WindowOcc): readonly Step[] => slots[occ.slotIdx]!.test.body.slice(occ.start, occ.start + length);
  const literalsOf = (occ: WindowOcc): readonly Literals[] => slots[occ.slotIdx]!.analyses.slice(occ.start, occ.start + length).map((a) => a!.literals);
  const sourceOf = (occ: WindowOcc): string => slots[occ.slotIdx]!.entry.source;

  const perOccLiterals = occs.map((occ) => literalsOf(occ));
  const perOccTexts: string[][] = occs.map((occ, occIdx) => {
    const src = sourceOf(occ);
    const flat: string[] = [];
    for (const stepLits of perOccLiterals[occIdx]!) for (const lit of stepLits) flat.push(src.slice(lit.span.start.offset, lit.span.end.offset));
    return flat;
  });
  const flatHints: string[] = [];
  for (const stepLits of perOccLiterals[0]!) for (const lit of stepLits) flatHints.push(lit.hint);

  const slotCount = flatHints.length;
  const usedParamNames = new Set<string>();
  const flatParamNames: (string | null)[] = [];
  for (let i = 0; i < slotCount; i++) {
    const texts = perOccTexts.map((t) => t[i]!);
    const allSame = texts.every((t) => t === texts[0]);
    if (allSame) {
      flatParamNames.push(null);
    } else {
      const base = camelize(flatHints[i] ?? '') || `param${i + 1}`;
      flatParamNames.push(dedupeName(base, usedParamNames).replace(/ /g, ''));
    }
  }
  const params = flatParamNames.filter((n): n is string => n !== null);

  // Reshape the flat per-slot decision back into [stepIdx][literalIdxWithinStep], matching
  // `perOccLiterals[0]`'s own nesting (both built by the same traversal order).
  let flatCursor = 0;
  const templateParamNames: (string | null)[][] = perOccLiterals[0]!.map((stepLits) => stepLits.map(() => flatParamNames[flatCursor++]!));

  const occurrences: ReuseOccurrence[] = occs.map((occ, occIdx) => {
    const steps = stepsOf(occ);
    const first = steps[0]!;
    const last = steps[steps.length - 1]!;
    const args: string[] = [];
    for (let i = 0; i < slotCount; i++) if (flatParamNames[i] !== null) args.push(perOccTexts[occIdx]![i]!);
    return {
      path: slots[occ.slotIdx]!.entry.path,
      testName: slots[occ.slotIdx]!.test.name.value,
      startLine: first.span.start.line,
      endLine: last.span.end.line,
      span: { start: first.span.start, end: last.span.end },
      args,
    };
  });

  return {
    length,
    occurrences,
    actionName: proposeActionName(stepsOf(occs[0]!)),
    params,
    templateEntry: slots[occs[0]!.slotIdx]!.entry,
    templateSteps: stepsOf(occs[0]!),
    templateParamNames,
  };
}

function finalizeHint(id: string, actionName: string, draft: DraftHint): ReuseHint {
  const actionFile = `shared/${kebab(actionName)}.tflw`;
  const actionSource = renderActionSource(actionName, draft);
  const occurrences = draft.occurrences;
  const diffPreview = renderDiffPreview(id, actionName, actionFile, draft.length, occurrences, draft.params);
  return { id, length: draft.length, occurrences, actionName, params: draft.params, actionFile, actionSource, diffPreview };
}

/** camelCase from free text: strip non-alnum, lowercase-first-word + capitalize the rest. */
function camelize(text: string): string {
  const words = text
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
  if (words.length === 0) return '';
  return words[0] + words
    .slice(1)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
}

/** kebab-case from a space-separated action name, for its `shared/<slug>.tflw` file name. */
function kebab(actionName: string): string {
  return actionName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
    .join('-');
}

function proposeActionName(steps: readonly Step[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type === 'ClickStmt') return words(s.locator.value.value);
  }
  for (const s of steps) {
    if (s.type === 'ApiStep') return words(`${s.method} ${lastPathSegment(s.path.raw)}`);
  }
  for (const s of steps) {
    if (s.type === 'OpenStmt') return words(lastPathSegment(s.path.value));
  }
  return 'shared steps';
}

function lastPathSegment(raw: string): string {
  const clean = raw
    .split('?')[0]!
    .replace(/\{[^}]*\}/g, '')
    .replace(/\/+$/, '');
  const parts = clean.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? 'root';
}

const STATEMENT_KEYWORD_SET: ReadonlySet<string> = new Set(STATEMENT_KEYWORDS);

function words(text: string): string {
  const w = text
    .split(/[^a-zA-Z0-9]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.toLowerCase());
  if (w.length === 0) return 'shared steps';
  // A bare `CallStmt`'s call site is just `<name>(...)` as a standalone step — if the generated
  // name's first word happens to be a real statement keyword (most reliably reachable via the
  // `OpenStmt` fallback above, whose source path segment can itself be a word like "open", but
  // also possible from a `ClickStmt`'s own user-facing locator text, e.g. a button literally
  // labeled "Close panel"), the parser's statement dispatcher greedily routes on that leading
  // word and never considers "this might be a call to a user action" — `open products()` fails
  // to parse the same way a hand-written one would (TF010, "expected a path to open"). Found via
  // M7 acceptance running `tflw refactor apply` against a real extraction whose only `OpenStmt`
  // opened `/products/{id}` (testFlow-tests' webv2-storefront.tflw). "the" is never a statement
  // keyword, so prefixing with it always produces a parseable call site.
  if (STATEMENT_KEYWORD_SET.has(w[0]!)) return ['the', ...w].join(' ');
  return w.join(' ');
}

// ---------------------------------------------------------------------------
// Rendering — the extracted action + call-site text
// ---------------------------------------------------------------------------

/** Splice occurrence 0's own source text verbatim, replacing every literal that became a
 * parameter with `{paramName}` — everything else (structural text, identical literals, original
 * spacing/quoting) is copied through byte-for-byte. */
function renderActionSource(actionName: string, draft: DraftHint): string {
  const { templateEntry, templateSteps, templateParamNames, params } = draft;
  const first = templateSteps[0]!;
  const last = templateSteps[templateSteps.length - 1]!;
  // Start from the *line* containing the first step, not its token offset — every other line in
  // this slice carries its own real leading whitespace (it's a full line), so the first one must
  // too, or `normalizeIndent`'s min-indent calc sees a bogus 0 and double-indents everything else.
  const startOff = lineStartOffset(templateEntry.source, first.span.start.offset);
  const endOff = last.span.end.offset;

  const replacements: { start: number; end: number; text: string }[] = [];
  templateSteps.forEach((step, i) => {
    const analysis = analyzeStep(step)!;
    analysis.literals.forEach((lit, j) => {
      const paramName = templateParamNames[i]![j];
      if (paramName !== null) replacements.push({ start: lit.span.start.offset, end: lit.span.end.offset, text: `{${paramName}}` });
    });
  });
  replacements.sort((a, b) => a.start - b.start);

  let body = '';
  let cursor = startOff;
  for (const r of replacements) {
    body += templateEntry.source.slice(cursor, r.start);
    body += r.text;
    cursor = r.end;
  }
  body += templateEntry.source.slice(cursor, endOff);

  const bodyLines = normalizeIndent(body.split('\n'));
  return [`action ${actionName}(${params.join(', ')})`, ...bodyLines].join('\n') + '\n';
}

/** Re-indent a block of source lines to a flat 2-space single level, regardless of how deeply
 * they were originally nested (a window is always top-level test-body steps by construction, but
 * this keeps `renderActionSource` correct even if that ever changes). */
function normalizeIndent(lines: readonly string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const minIndent = nonEmpty.length > 0 ? Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length)) : 0;
  return lines.map((l) => (l.trim().length === 0 ? '' : '  ' + l.slice(minIndent)));
}

function renderCallLine(actionName: string, args: readonly string[]): string {
  return args.length > 0 ? `${actionName}(${args.join(', ')})` : `${actionName}()`;
}

function renderDiffPreview(
  id: string,
  actionName: string,
  actionFile: string,
  length: number,
  occurrences: readonly ReuseOccurrence[],
  params: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(`reuse[${id}]: ${occurrences.length} occurrences of a similar ${length}-step sequence`);
  for (const occ of occurrences) lines.push(`  --> ${occ.path}:${occ.startLine} (test "${occ.testName}")`);
  lines.push(`  = proposed: action ${actionName}(${params.join(', ')}) in ${actionFile}`);
  for (const occ of occurrences) lines.push(`  = call site: ${renderCallLine(actionName, occ.args)}`);
  lines.push(`  = apply: tflw refactor apply ${id}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Source-splice helpers for `tflw refactor apply` (CLI-side I/O lives in the CLI package; this
// stays pure so it's directly unit-testable here).
// ---------------------------------------------------------------------------

function lineStartOffset(source: string, offset: number): number {
  const i = source.lastIndexOf('\n', offset - 1);
  return i === -1 ? 0 : i + 1;
}

function lineEndOffset(source: string, offset: number): number {
  const i = source.indexOf('\n', offset);
  return i === -1 ? source.length : i + 1;
}

/** The exact `[start, end)` byte range (whole lines, trailing newline included) an occurrence's
 * call site replaces, plus the replacement text itself (original indentation preserved). Multiple
 * occurrences in the same file must be applied in descending `start` order so earlier edits don't
 * shift later offsets. */
export function renderCallSiteReplacement(actionName: string, occurrence: ReuseOccurrence, source: string): { readonly start: number; readonly end: number; readonly text: string } {
  const start = lineStartOffset(source, occurrence.span.start.offset);
  const end = lineEndOffset(source, occurrence.span.end.offset);
  const indent = ' '.repeat(occurrence.span.start.column - 1);
  return { start, end, text: `${indent}${renderCallLine(actionName, occurrence.args)}\n` };
}

/** Offset to insert a new `import "…"` line at, for a file that needs one to reach a freshly
 * extracted action (`tflw refactor apply`) — right after the last existing import's line, or at
 * the very top if the file has none yet. */
export function importInsertionOffset(program: Program, source: string): number {
  if (program.imports.length === 0) return 0;
  const last = program.imports[program.imports.length - 1]!;
  return lineEndOffset(source, last.span.end.offset);
}
