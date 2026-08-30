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
  /** Every top-level block, functional and workload-bearing alike, in file declaration order
   * (M50, D93-D95, PLAN_UNIFIED_TEST_WORKLOAD.md). Kind is inferred per-block from
   * `TestDecl.workload`, not carried in a separate array — `scenario` no longer exists as its own
   * keyword or AST node; `tflw run` walks this single array in order (D100). */
  readonly tests: readonly TestDecl[];
  /**
   * `crawl` declarations (`M137c`, `D432`) — a separate array rather than a `TestDecl` variant.
   *
   * `D93` folded `scenario` into `TestDecl` because a workload-bearing test differed from a functional
   * one only by a clause it already carried. A crawl is not that: it has no authored body to schedule,
   * no `retry`/`with each`, and its output is findings and coverage. Keeping it beside `tests` rather
   * than inside means no consumer of `Program.tests` has to learn a shape it cannot use — the same
   * reason `hooks` and `actions` are their own arrays.
   *
   * **Optional, and omitted entirely when there is nothing to record** — `recoveredSpans` below
   * records why, and the reason applies unchanged. Written as a required field first, it would put
   * `"crawls": []` into the serialised AST of every program in the language and turn all 31 parser
   * golden files red for files that declare no crawl. Absent-when-empty keeps those goldens asserting
   * what they were written to assert, and the field appears only on the programs it describes.
   */
  readonly crawls?: readonly CrawlDecl[];
  /**
   * Spans the parser already diagnosed and then had to leave a **recovery node** behind at (M99a,
   * D168b). Empty for every program that parses.
   *
   * `D167`'s back-off returns `VarRef(first)` when a word run misses `(`, which is right in the
   * positions `A3-05` names — `random number lo to hi` needs `lo` to *be* a variable. But in the one
   * shape that stays an error, `let a = create order`, that same `VarRef` is junk the parser
   * invented to keep going, and `checkUnknownVariables` then reported ``unknown variable "create"``
   * underneath the paren advice: one mistake, two errors, the second one nonsense. Before D167 the
   * production returned `null`, so no node existed to misread.
   *
   * **It rides on the AST rather than through `ProgramCheckOptions` deliberately.** Every consumer
   * already passes the `Program` — so unlike `missingFiles`, there is no second thing to remember at
   * three call sites, which is the drift D146 exists to prevent. It is a *span* set rather than a
   * name set because skipping by name would silence a genuine `create` bound elsewhere in the file.
   *
   * **Optional, and omitted entirely when there is nothing to record.** Written as a required field
   * first, which changed the serialised AST of every program in the language and turned all 31
   * parser golden files red — recovery metadata in the snapshot of a file that parses perfectly.
   * Absent-when-empty keeps a healthy program's AST byte-identical to what it has always been, so
   * the goldens still assert what they were written to assert, and the field appears only on the
   * programs it actually describes.
   */
  readonly recoveredSpans?: readonly Span[];
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

/** A `test "…" { … }` block — functional or workload-bearing, distinguished only by
 * `workload !== null` (M50, D93-D95). Before M50 these were two separate keywords/AST node
 * types (`test`/`TestDecl` vs `scenario`/`ScenarioDecl`); `scenario` carried a mandatory
 * `workload` plus its own `thresholds` (and a `cleanup` flag, retired by `M157c`), and forbade
 * `retry`/`table` (checker-enforced,
 * D96). Collapsing them removed an entire keyword and AST node type — nothing else in the
 * grammar distinguished a load test from a functional one, so the workload clause's presence is
 * now the only signal (D94). */
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
   * silently green (SPEC §4.4, P#10). `0` (the default) means no retry. Checker-rejected
   * (D96) alongside a non-null `workload`. */
  readonly retry: number;
  /** `with each` — one reported case per row, or null for an ordinary single-case test
   * (SPEC §4.3, P#10/24). Checker-rejected (D96) alongside a non-null `workload`. */
  readonly table: DataTable | null;
  /** Non-null makes this a workload-bearing (load) test — a per-VU loop (workload + optional
   * `think` pacing) around `body`, instead of the ordinary single-shot functional execution
   * (M50, formerly `ScenarioDecl.workload`, mandatory there). Null (the default) is today's
   * unchanged functional test. */
  readonly workload: Workload | null;
  /** `threshold …` lines (D24a) — aggregate pass/fail assertions evaluated once, after the whole
   * run, against the run's accumulated metrics. Order in source is preserved for report display
   * but has no semantic effect. Empty unless `workload` is set (formerly `ScenarioDecl.thresholds`). */
  readonly thresholds: readonly ThresholdDecl[];
  /** `parallel`/`sequential` (D105-D107) — this test's execution relation to *other* tests in the
   * same file, checked right after `retry` on the header line. Always present (never inferred
   * downstream): the parser resolves the default itself. `'sequential'` (the default) blocks the
   * next batch until this test finishes, matching today's plain execution shape. `'parallel'`
   * joins a maximal run of consecutive `parallel` tests into one concurrently-executed batch
   * (D109) — legal on any test regardless of kind, `retry`, or `table` (D112's last paragraph): a
   * `with each` test's own rows stay internally sequential either way, only this test's relation
   * to other file-level tests changes. */
  readonly concurrency: 'parallel' | 'sequential';
  readonly body: readonly Step[];
}

/**
 * `crawl "the v1 API surface" as peer, shopperBearer` — Tier 4's active crawl (`M137c`, `D432`/`D450`).
 *
 * A **top-level declaration, sibling to `test`**, written in an ordinary `.tflw` file and executed by
 * plain `tflw run`. It is deliberately *not* a sixth workload kind, and not a `tflw scan` mode:
 *
 * - `D364` killed the mode on evidence (`M50`–`M53` spent four milestones collapsing `tflw load` into
 *   `tflw run`), and that evidence is about **entry points**, not constructs. `tflw init --load` still
 *   scaffolds a distinct construct with no distinct entry point; this follows it.
 * - A workload kind is a *scheduling policy over an unchanged authored body* — the whole dispatch
 *   decides only when and how often to call `runIteration`. A crawl's defining behaviour is issuing
 *   requests nobody wrote, which has nowhere to live in that chain without inverting the body's role.
 *
 * What it adds to the language is a **source of requests**, not a kind of judgement: the `expect …`
 * lines in `body` are the same three matcher families the arc already ships, applying per response the
 * crawl issues exactly as they apply per response inside a `test` (`D450`). Tier 4 adds no matcher
 * vocabulary and no fourteenth subject keyword.
 */
export interface CrawlDecl extends Node {
  readonly type: 'CrawlDecl';
  readonly name: StringLit;
  /** Tags sit on their own lines above the header, exactly as they do above `test`, so `--tag`
   * reaches a crawl with no CLI change. */
  readonly tags: readonly string[];
  /** `as peer, shopperBearer` — the same comma list `test` takes, and the multi-principal case is the
   * one Tier 2 taught us matters: a crawl as several principals needs no new syntax. Empty means the
   * crawl sends no credential, which is legal and usually not what the author wanted. */
  readonly sessions: readonly string[];
  /** `seed openapi "/openapi.json"` / `seed traffic` — where the surface comes from. Order is
   * preserved for reporting but has no semantic effect; a crawl with none is `TF068` (`D443`). */
  readonly seeds: readonly CrawlSeed[];
  /** `exclude "/vuln/**"` — same verb the config dialect already uses for *drop things from a
   * discovered set* (SPEC §3.9), disambiguated by block rather than by a new word. */
  readonly excludes: readonly StringLit[];
  /** The `expect …` lines. Parsed as ordinary steps and **restricted by the checker**, not by the
   * grammar — same layering as `D96`'s `retry`-vs-workload rule and `D19`'s browser-step rejection:
   * a semantic rule about the fully-formed node, not a grammar ambiguity. */
  readonly body: readonly Step[];
}

/** One `seed` line inside a `crawl` body (`D435`/`D436`/`D442`). `spider` arrived in `M137f`, which
 * is what the previous version of this comment reserved the slot for — the type gains its member when
 * the capability does rather than advertising one that resolves to nothing. */
export type CrawlSeed = OpenApiSeed | TrafficSeed | SpiderSeed;

/**
 * `seed openapi "/openapi.json"` — the documented surface.
 *
 * The path follows the same convention `contract.ts` already established for
 * `expect body matches schema … from "source"`: absolute `http(s)://` passes through, anything else
 * resolves against the default service's base URL, the way a plain `api GET /path` step does.
 */
export interface OpenApiSeed extends Node {
  readonly type: 'OpenApiSeed';
  /**
   * Named `source`, not `path`, and the name is load-bearing twice over.
   *
   * It is a **URL**, not a file: it is fetched over HTTP the same way
   * `matches schema "Name" from "source"` fetches its document, and that matcher calls its own field
   * `schemaSource` for the same reason. Calling it `path` would also make `fileReferenceDrift` — the
   * guard that holds `FILE_BEARING_NODES` to `ast.ts` — demand a `TF043` file-existence check for it,
   * which would report a missing file for a document that lives on a server.
   */
  readonly source: StringLit;
}

/** `seed traffic` — the requests this run's own tests made, which is the seed that reaches code the
 * document does not describe. It takes no argument: the traffic is whatever the run captured. */
export interface TrafficSeed extends Node {
  readonly type: 'TrafficSeed';
}

/**
 * `seed spider "/admin"` — the browser surface, found by **fetching and parsing** (`M137f`, `D442`).
 * No browser engine: HTML is retrieved and its links and forms are read. That is a scope statement
 * about capability and, first, a safety one — every existing gate (`allow hosts`, the blocked-port
 * list, `authorized target`/`TF060`, `publicTargetRefusal`, sequential pacing) lives on the request
 * path, so a fetching spider inherits all of them and a rendering one would have had to re-establish
 * each at a different layer.
 *
 * **This is the first seed whose enumeration is itself traffic**, which is `D483`: `seed openapi`
 * fetches one document and `seed traffic` fetches nothing, so both resolve before the crawl discloses
 * what it will send. A spider cannot — the only way to learn a route exists is to fetch the page that
 * links to it. So a spider-seeded crawl discloses twice: the walk's *cap* before it walks, then
 * `D435`'s existing probe total before it probes. Neither phase sends anything before a line bounding
 * it has been printed, which is the property `D435` was protecting.
 */
export interface SpiderSeed extends Node {
  readonly type: 'SpiderSeed';
  /**
   * Where the walk starts. Named `root` rather than `source` or `path`: it is the origin of a *set* of
   * pages, not the address of one document, and `OpenApiSeed.source` is already the field name that
   * means "a document fetched over HTTP".
   *
   * Resolves exactly as `OpenApiSeed.source` does — absolute `http(s)://` passes through, anything
   * else against the default service's base URL — and for the same reason it must not be called
   * `path`: `fileReferenceDrift` would then demand a `TF043` file-existence check for a URL.
   */
  readonly root: StringLit;
  /**
   * `D435`'s "browser half — bound it", as declared numbers rather than as constants nobody can see.
   * Both optional in the grammar and both defaulted by the runtime, because a cap is a property of the
   * target's shape and an author who has walked their own app knows it better than this file does.
   *
   * They are sub-clauses indented beneath the seed line, which is the idiom `authorized target`
   * already established for optional modifiers on a declaration (SPEC §3.10) — `D450`'s rule that the
   * crawl derives its shape from existing idioms rather than inventing one.
   */
  readonly maxPages?: NumberLit;
  readonly maxDepth?: NumberLit;
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

// ---- Load testing (M29/M30/M50, PLAN_BROWSER_PERF_SECURITY.md §2, D16-D19/D24a/D26/D29/D30,
// PLAN_UNIFIED_TEST_WORKLOAD.md D93-D104) ------------------------------------------------------
//
// Through M30, `scenario` was a second, dedicated top-level keyword/AST node alongside `test` —
// a per-VU loop (workload + optional `think` pacing) around an ordinary `Step[]` body, so the
// same `action`s a functional suite already wrote are the reuse unit under load too. M50 removed
// `scenario`/`ScenarioDecl` entirely (D93): a `TestDecl` with `workload !== null` is exactly what
// a `ScenarioDecl` used to be (D94/D95) — nothing else in the grammar ever distinguished the two.
// Everything below this note (unique-name-within-a-file via `TF033`, `think` legality via D18,
// browser steps rejected inside a workload-bearing body via D19) still applies, just phrased
// against `TestDecl.workload` instead of a separate node type (`checker.ts`'s `checkWorkloadTests`,
// formerly `checkScenarios`).
export type Workload =
  | RampUsersWorkload
  | RampRpsWorkload
  | HoldUsersWorkload
  | HoldRpsWorkload
  | StepUsersWorkload
  | StepRpsWorkload
  | SpikeUsersWorkload
  | SpikeRpsWorkload
  | SharedIterationsWorkload
  | PerVuIterationsWorkload;

/** `ramp to N users over <dur>` (D17) — **closed** model: VUs loop continuously once spawned:
 * `users` ramps linearly from 0 to `users` over `overMs`, one VU roughly every `overMs/users`.
 * When the target system slows down, in-flight VUs simply take longer per iteration and issue
 * fewer of them — "coordinated omission": the load backs off exactly when it matters most, which
 * understates measured latency. The load report flags this (D17's back-off diagnostic) when
 * a closed run's VUs spent a large share of wall time waiting rather than iterating. */
export interface RampUsersWorkload extends Node {
  readonly type: 'RampUsersWorkload';
  readonly users: number;
  readonly overMs: number;
}

/** `ramp to N rps over <dur>` (D17) — **open** model: new iterations are scheduled at a target
 * arrival rate that itself ramps linearly from 0 to `rps` over `overMs`, independent of whether
 * earlier iterations have finished. Queues build under saturation instead of silently
 * disappearing — the only model that honestly validates an SLA. `tflw init --load` scaffolds this
 * form and the docs lead with it (D17). */
export interface RampRpsWorkload extends Node {
  readonly type: 'RampRpsWorkload';
  readonly rps: number;
  readonly overMs: number;
}

// ---- Load testing: the 4 new D97 workload kinds (Phase 1b, PLAN_UNIFIED_TEST_WORKLOAD.md) -----
//
// D97 chose distinct named keywords per workload shape over a generalized k6-style stage list.
// `hold` is a single flat level; `step`/`spike` are each a block of `Stage` lines (a staircase and
// a mixed hold/ramp schedule respectively); the two iteration forms are count-bounded with no
// duration at all. D98: every kind supports both closed (`users`) and open (`rps`) variants,
// matching `ramp`. D102: the count-based kinds skip the D17 back-off diagnostic entirely — there's
// no duration to divide by, so it's structurally undefined rather than a withheld feature.

/** `hold N users for <dur>` (D97) — closed model, no ramp: `users` VUs are all live for the whole
 * duration `forMs` (steady-state load, mirrors k6 `constant-vus`). Same D17 back-off diagnostic as
 * `ramp` applies (D98). */
export interface HoldUsersWorkload extends Node {
  readonly type: 'HoldUsersWorkload';
  readonly users: number;
  readonly forMs: number;
}

/** `hold N rps for <dur>` (D97) — open model, no ramp: a constant target arrival rate of `rps` for
 * the whole duration `forMs` (mirrors k6 `constant-arrival-rate`). */
export interface HoldRpsWorkload extends Node {
  readonly type: 'HoldRpsWorkload';
  readonly rps: number;
  readonly forMs: number;
}

/** One level of a `step`/`spike` stage list (D97). `mode: 'jump'` (`to N for <dur>` / `hold N for
 * <dur>`) holds flat at `target` for the whole stage — an instant level change at the stage
 * boundary, no ramp. `mode: 'ramp'` (`to N over <dur>`) linearly ramps from the previous stage's
 * ending target (0 before the first stage) to `target` over the stage's own duration — the same
 * math as `ramp to … over …`, just one leg of a multi-leg schedule. */
export interface Stage extends Node {
  readonly type: 'Stage';
  readonly mode: 'jump' | 'ramp';
  readonly target: number;
  readonly durationMs: number;
}

/** `step users` (D97) — closed model: a block of `to N for <dur>` lines, each an instant jump to
 * a new level held for its own duration (a staircase; mirrors k6 `ramping-vus` fed a
 * staircase-shaped stage list, surfaced here as its own keyword per D97 rather than a generic
 * stage list). At least one stage is required. */
export interface StepUsersWorkload extends Node {
  readonly type: 'StepUsersWorkload';
  readonly stages: readonly Stage[];
}

/** `step rps` (D97) — open model equivalent of `StepUsersWorkload`. */
export interface StepRpsWorkload extends Node {
  readonly type: 'StepRpsWorkload';
  readonly stages: readonly Stage[];
}

/** `spike users` (D97) — closed model: a block mixing `hold N for <dur>` (flat, `mode: 'jump'`)
 * and `to N over <dur>` (ramped, `mode: 'ramp'`) lines — typically baseline → ramp up → hold peak
 * → ramp down → baseline. At least one stage is required. */
export interface SpikeUsersWorkload extends Node {
  readonly type: 'SpikeUsersWorkload';
  readonly stages: readonly Stage[];
}

/** `spike rps` (D97) — open model equivalent of `SpikeUsersWorkload`. */
export interface SpikeRpsWorkload extends Node {
  readonly type: 'SpikeRpsWorkload';
  readonly stages: readonly Stage[];
}

/** `run N iterations across M users` (D97) — count-bounded, no duration: `vus` VUs pull from a
 * shared pool of `iterations` total iterations until it's exhausted (mirrors k6
 * `shared-iterations`). No D17 back-off diagnostic (D102). */
export interface SharedIterationsWorkload extends Node {
  readonly type: 'SharedIterationsWorkload';
  readonly iterations: number;
  readonly vus: number;
}

/** `run N iterations per user across M users` (D97) — count-bounded: each of `vus` VUs runs
 * exactly `iterationsPerVu` iterations independently (mirrors k6 `per-vu-iterations`). No D17
 * back-off diagnostic (D102). */
export interface PerVuIterationsWorkload extends Node {
  readonly type: 'PerVuIterationsWorkload';
  readonly iterationsPerVu: number;
  readonly vus: number;
}

export type ThresholdMetric =
  | { readonly kind: 'duration'; readonly percentile: number }
  | { readonly kind: 'errorRate' };

/** Reuses the existing `is less than`/`is greater than` comparator vocabulary (SPEC §6.2) rather
 * than inventing symbolic operators — house style keeps the grammar spelled-out. */
export type ThresholdOp = 'lessThan' | 'greaterThan';

/** `threshold p95 duration is less than 800ms` / `threshold error rate is less than 1%` (D24a).
 * `value` is milliseconds for a `duration` metric, a 0-1 fraction for `errorRate` (`1%` parses to
 * `0.01`). Evaluated once, after the whole run, against accumulated metrics — never mid-run. */
export interface ThresholdDecl extends Node {
  readonly type: 'ThresholdDecl';
  readonly metric: ThresholdMetric;
  readonly op: ThresholdOp;
  readonly value: number;
  /** `threshold p95 duration for "checkout" is less than 250ms` (M43, D70) — scopes this
   * threshold to one endpoint's own histogram instead of the whole test's. Matches either an
   * explicit `ApiRequestSpec.tag` or an automatically-derived `METHOD path.raw` identity string.
   * Null (the default) keeps today's whole-iteration-scoped meaning unchanged. Checker-enforced
   * (`TF034`) to resolve to at least one step's identity within the same test.
   *
   * `scenario` was the keyword here until `M50` folded it into `test`; `tflw migrate` still
   * rewrites it in *source*, but nothing rewrites it in prose, which is how it survived here for
   * eleven milestones (`A2-16`). The `M144a` denylist cannot reach it — that guard knows removed
   * *command* names, and this is a removed *keyword*. */
  readonly scope: StringLit | null;
}

/** `pause 2s` / `pause 1s to 3s` (D18; `think` until FS-05) — per-iteration pacing inside a
 * workload-bearing `test` only; the checker rejects it inside a functional `test`/`before`/`after`
 * (`TF033`) so decision 8's `sleep` ban stays meaningful where it was aimed (functional sync hacks)
 * while remaining a legitimate load-modeling primitive here. A range picks a fresh uniform duration
 * each iteration (`maxMs: null` means a fixed `minMs`). Excluded from the test's own `duration`
 * threshold metric — pacing is not system latency; counting it would let a load test satisfy a
 * latency threshold merely by sleeping more.
 *
 * FS-05 renamed the keyword from `think`: the word described the *modelled user*, not the
 * statement, which left the language with `think` and `wait until` as two unrelated-sounding names
 * for "stop here for a bit" and "poll until true". `pause` says what it does and stays
 * unambiguous against `wait until` — the collision a `wait <dur>` spelling would have
 * reintroduced. */
export interface PauseStmt extends Node {
  readonly type: 'PauseStmt';
  readonly minMs: number;
  readonly maxMs: number | null;
}

/**
 * A step the parser identified and then could not finish — the `api` line whose body would not
 * parse, the `capture` with no name after `as` (`M147c`, `M140-01`).
 *
 * **It exists so that later passes stop reading a parse failure as a fact about the user's file.**
 * A step that fails to parse used to be dropped from the body outright, and every pass that answers
 * a question by looking at what *precedes* a step then answered it from a body the user did not
 * write. Measured, both from one mistake: `api POST /o body [1, 2]` raises `TF010` and then `TF039`
 * *"no response yet — an `api` step must run before this assertion/capture"* on the next line, which
 * is false — an `api` step is written right there; and `capture body.id as` raises `TF010` and then
 * `TF030` *"unknown variable"* on every later use of a name the user did bind. The second diagnostic
 * in each pair is not merely redundant, it contradicts the file.
 *
 * **`head` is the keyword the user actually typed**, not what the parser decided the step meant —
 * `'api'`, `'capture'`, `'wait until api'`, or a misspelling if that is what is there. The parser
 * reports what is written; which heads matter is each pass's own decision, and `checker.ts` makes it
 * in two places for two different reasons. Recording an "establishes a response"/"binds a name"
 * classification here instead would put one consumer's semantics into the syntax tree.
 *
 * **Distinct from `recoveredSpans`, which stays**, and the split is worth keeping straight: that
 * field lets a pass suppress a diagnostic the parser *already caused at the same span*, matched by
 * offset. This node is for the opposite shape — the wrong diagnostic lands on a **different line**
 * from the mistake, sometimes several lines later and more than once, so there is no span to match
 * on. What is needed is not a filter but a placeholder that holds the position in the body.
 *
 * Never present in a program that parses, so no consumer on the path that matters ever sees one,
 * and no parser golden file changes. Nothing executes it: `tflw run` refuses a program with parse
 * errors before `execSteps` is reached.
 */
export interface MalformedStep extends Node {
  readonly type: 'MalformedStep';
  /** The keyword the step began with, as written. */
  readonly head: string;
}

export type Step =
  | ApiStep
  | ExpectStmt
  | LetStmt
  | CaptureStmt
  | LogStmt
  | WaitUntilApiStmt
  | WaitUntilUiStmt
  | GiveStmt
  | CallStmt
  | HeaderStmt
  | CsrfStmt
  | OpenStmt
  | ClickStmt
  | FillStmt
  | FillFormStmt
  | SelectStmt
  | TickStmt
  | UntickStmt
  | PressStmt
  | HoverStmt
  | ScrollStmt
  | WithinBlock
  | AcceptDialogStmt
  | DismissDialogStmt
  | SwitchToNewTabBlock
  | SwitchToTabStmt
  | CloseTabStmt
  | DownloadBlock
  | DragStmt
  | DropFileStmt
  | ScreenshotStmt
  | StubStmt
  | PauseStmt
  | MalformedStep;

/** `give <expr>` — an action's return value; ends its step sequence (P#17). */
export interface GiveStmt extends Node {
  readonly type: 'GiveStmt';
  readonly value: Value;
}

/** `login("alice", "secret1")` — a bare call to an `action` or `use`d JS/TS helper as a standalone
 * step, its return value (if any) discarded (M6, P#2). Before M6 a call could only appear as a
 * `Value` (`let x = login(...)`); the reuse pass needs a natural call-site for an extracted
 * sequence that produces nothing worth binding, so a bare-call statement form was added alongside
 * it — a small, generically useful grammar completion, not reuse-pass-specific machinery itself. */
export interface CallStmt extends Node {
  readonly type: 'CallStmt';
  readonly call: CallExpr;
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

/**
 * `csrf from <subject> send as header "<name>"` — capture a CSRF token out of this session's own
 * establishment response and attach it to every **mutating** request the credential later makes
 * (M137b, D433).
 *
 * **A session-body statement, not a scanner clause, because a CSRF token is a property of the
 * credential.** One target has many principals with different tokens; one principal has one. The
 * security corpus already says so in the other direction — `shopper` and `shopperBearer` are the
 * same human declared twice, because a probe outcome is a fact about the credential rather than
 * about the person.
 *
 * **In the `Step` union but reachable only from a session body**, which is deliberate: it is
 * dispatched by `parseSessionBlock`, and `parseStep` never offers it, so `csrf from …` written in a
 * `.tflw` test body is an unknown step with the existing code rather than a new checker rule with a
 * new one. `HeaderStmt` above is genuinely dual-purpose (a session header *and* a request header);
 * this is not, and the grammar is where that asymmetry is cheapest to express.
 *
 * `subject` is an ordinary `Subject`, the same one `capture` reads, so `body.csrfToken` and
 * `response.headers["X-CSRF-Token"]` both work and neither needed new path machinery. `header` is a
 * `StringLit` for `HeaderStmt`'s reason — it is a header name, and interpolation in it is resolved
 * at execution the same way.
 */
export interface CsrfStmt extends Node {
  readonly type: 'CsrfStmt';
  readonly subject: Subject;
  readonly header: StringLit;
}

// ---- API steps -------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

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
  /** `as "checkout"` (M43, D67/D68) — an explicit, k6-style opt-in label. When present it
   * *replaces* the automatic `(service, method, path.raw)` endpoint identity for load-report
   * aggregation and `threshold … for "label"` scoping, rather than merely relabeling it — this is
   * what lets a tflw scenario share an identity with a k6 script's own `{name: 'checkout'}` tag.
   * Only meaningful for a workload-bearing test; ignored by `test`/`action` execution. Null means the step
   * falls back to the automatic identity. */
  readonly tag: StringLit | null;
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
  /** `timeout wait <duration>` (`M147d`, `A3-10`, D640) — this step's own poll budget in ms, or
   *  null for the active env's `timeout wait`.
   *
   *  **Not `request.timeoutMs`, and the difference is the whole row.** `wait until api GET /jobs
   *  timeout 30s` has always parsed, and sets how long *one poll's HTTP request* may take — then
   *  decision 67 clamps even that to whatever is left of the wait deadline. It does not lengthen the
   *  wait by a millisecond. `A3-10` read that acceptance as a capability the locator form lacked;
   *  on the quantity actually at issue the two forms were equally narrow, so this widens both. */
  readonly waitMs: number | null;
}

/** `wait until <locator> [not] <matcher> [for <duration>]` (SPEC §9.5, M3b; `for` added by FS-05) —
 * the UI sibling of `wait until api`: same "budget, not a moment" semantics, but for a UI condition
 * that can outlast the ordinary UI expect budget (`timeout expect`, default 5s) without a separate
 * request to re-issue, so it's a single line rather than a block. Polls up to `timeout wait`
 * (default 30s, same clock `wait until api` uses) and always hard-fails on exhaustion — there is no
 * soft/`check` form. */
export interface WaitUntilUiStmt extends Node {
  readonly type: 'WaitUntilUiStmt';
  /** Widened from `LocatorSubject` by `M147d`/`A3-11` (D641) — see `pollable()` for the rule and
   * for why this type is deliberately *wider* than the predicate that admits it. */
  readonly subject: PollableSubject;
  readonly matcher: Matcher;
  /** `for <duration>` (FS-05) — how long the condition must hold *continuously* before the step
   * passes, in ms; `null` is the original semantics, "pass the first poll it is true".
   *
   * This is what makes a *sustained* condition writable at all. Without it, `wait until text
   * "Error" is hidden` returns on its first poll, which for a toast that has not rendered yet is
   * immediately — the assertion passes precisely because nothing has happened, and keeps passing
   * once the toast starts appearing. Proving a negative needs a span, not an instant. The hold
   * clock restarts from zero whenever the condition goes false, so the step passes only on an
   * uninterrupted window, and the whole thing stays bounded by `timeout wait`. */
  readonly holdMs: number | null;
  /** `timeout wait <duration>` (`M147d`, `A3-10`, D640) — this step's own poll budget in ms, or
   *  null for the active env's `timeout wait`. Identical in meaning to the api form's field of the
   *  same name; the two clauses are one production read from both rests.
   *
   *  It is also the second operand `TF055` compares `holdMs` against. Written here, both operands
   *  are in the file and the check no longer needs a resolved env to run at all — D147's reason for
   *  keeping that code a *warning* is exactly the env dependency this clause removes. The tier did
   *  not change in `M147d`; see SPEC §9.5 for why that is now an open question rather than a
   *  settled one. */
  readonly waitMs: number | null;
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
  /** The JSON document being sent — an object or a **top-level array** (`M147d`, `A3-12`, D639).
   *
   *  Named `value` rather than `object` because it is no longer always an object. Three of the four
   *  surfaces that read a top-level JSON document already accepted an array before D639 — `body from`
   *  reads any JSON the file contains, `expect body equals [1, 2]` matches one, and `body { items: [1,
   *  2] }` nests one a single level down — so the inline request body was the odd one out, and D627's
   *  rider resolves an asymmetry by widening the narrower side. */
  readonly value: ObjectLit | ArrayLit;
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
  /** Zero or more trailing `mask <locator>` clauses (M4b, D15) — dynamic regions (timestamps,
   * avatars, order IDs) to paint over before a `matches snapshot "…"` comparison. Meaningless
   * (and never parsed) on any other matcher; a plain `[]` here, not `undefined`, when none given. */
  readonly masks: readonly Locator[];
}

export type Subject =
  | StatusSubject
  | DurationSubject
  | HeaderSubject
  | BodySubject
  | BodyTextSubject
  | BodyBytesSubject
  | BodyCsvSubject
  | BodyPdfTextSubject
  | RequestSubject
  | NetworkRequestSubject
  | LocatorSubject
  | PageSubject
  | ResponseSubject
  | DialogMessageSubject
  | DialogTypeSubject
  | ValueSubject;

/** `expect dialog message is "Delete this product?"` (M159, `D798`, SPEC §9.1) — the text of the
 * last native dialog **of this attempt**.
 *
 * Two bare words, no hyphen, which is `D628`'s two-surface rule: the config dialect and the CLI
 * take the hyphen, the language does not. It is a value subject in the ordinary sense — a thing a
 * prior step produced that a matcher stands against — so it needs no new grammar beyond the head
 * word, and every string matcher already works on it.
 *
 * **This is what makes `dismiss dialog` provable at all.** `M154b-01`: `null` and `'dismiss'` took
 * the same branch in the handler, because the browser driver's unhandled default *is* dismissal, so
 * deleting a `dismiss dialog` line changed no assertion anywhere. A test that dismisses can now
 * assert the dialog existed and said what it should. On an `alert` it is the *only* thing that can
 * be asserted (SPEC §9.1's per-kind table): accept and dismiss have identical page effect there,
 * which generalises the row from one step to one dialog kind. */
export interface DialogMessageSubject extends Node {
  readonly type: 'DialogMessageSubject';
}

/** `expect dialog type is "confirm"` (M159, `D799`, SPEC §9.1) — which of the four native modal
 * kinds the last dialog of this attempt was: `alert`, `confirm`, `prompt` or `beforeunload`.
 *
 * A **string** subject over a closed set, not a new matcher: `is`/`equals` already compare strings
 * and nothing about four possible values needs its own comparison. The set is stated in SPEC and in
 * the manifest row so a reader knows the four without reading the browser driver's documentation.
 *
 * It closes a blind spot nothing had filed: the runtime never read `dialog.type()`, so a test could
 * not tell a `confirm()` from an `alert()` — and the regression where a guard is removed, a
 * destructive action's `confirm()` becoming an unconditional `alert()`, was invisible. The
 * `accept dialog` still "worked", the action still happened, every assertion still passed. */
export interface DialogTypeSubject extends Node {
  readonly type: 'DialogTypeSubject';
}

/** `expect {orderId} is greater than 0` / `expect all {items.price} …` (M96, `FU-11`, SPEC §6.1) —
 * a value the test already bound with `let`/`capture`, asserted *on* rather than only compared
 * against. Subject position accepts an interpolation and nothing else (D129): a literal or an
 * arithmetic expression would make `expect 2 equals 2` grammatical, and a bare identifier would
 * collide with the seven single-word locator/response keywords (`text`, `status`, `list`, …), so a
 * user's `let text = "hi"` would silently become a UI assertion.
 *
 * `ref` is the same `PathSegment[]` an `Interp` carries — head segment is the bound name, the rest
 * navigate into it. The braces are syntax, not part of the name: failure labels read `orderId` /
 * `items[2].price`, because the report shows a value. */
export interface ValueSubject extends Node {
  readonly type: 'ValueSubject';
  readonly ref: readonly PathSegment[];
}

/** Which subjects an `any`/`all` quantifier may stand in front of (SPEC §6.3, D131). Lives here, on
 * the AST, because the parser rejects the rest and `evaluateQuantified` re-asserts the same triple
 * at run time — two statements of one rule that M96 would otherwise have widened independently. */
export function quantifiable(subject: Subject): subject is BodySubject | BodyCsvSubject | ValueSubject {
  return subject.type === 'BodySubject' || subject.type === 'BodyCsvSubject' || subject.type === 'ValueSubject';
}

/** Which subjects `wait until <subject> <matcher>` may stand in front of (`M147d`, `A3-11`, D641).
 *
 * The rule is not a list, it is a property: **a subject is pollable exactly when re-reading it
 * between two polls can produce a different answer.** Everything the language can name divides
 * cleanly on that, and the division is one the runtime had already made for its own reasons —
 * `execSteps`' `ExpectStmt` case routes a locator to `execUiExpect`, `page` to `execA11yExpect`
 * and `request to "…"`/`… of request to "…"` to `execNetworkExpect`, and all three re-observe the
 * browser on every iteration of their own retry loop. Every other subject reads the *response
 * scope*, which exactly one `api` step writes; between two polls of a `wait until` nothing runs, so
 * `status`, `duration`, `header "…"`, `body …`, `response` and `request` hold the same value they
 * held on the first poll and always will. Such a step either passes immediately or spins to its
 * deadline blaming an endpoint that was never consulted a second time.
 *
 * `A3-11` asked for the opposite of this — `wait until body.state equals "done"`, polling the last
 * API response — and it is the one subject shape the rule can prove is never worth admitting. The
 * capability it wanted already has a spelling that re-issues the request (`wait until api …`); what
 * the row was right about is that *three* live-browser shapes were being refused alongside it by a
 * guard that tested for `LocatorSubject` and nothing else.
 *
 * `ValueSubject` is excluded by the same argument one step over, and does not even need this
 * function to say so: `TF041` already refuses a `{variable}` inside `wait until api` because a
 * bound value cannot change between polls. D641 is that sentence generalised from one construct
 * and one subject to both constructs and all of them.
 *
 * **The type is wider than the predicate, deliberately.** The four `of request to "…"`-bearing
 * subjects are pollable only when that clause is actually present, which is a value test TypeScript
 * cannot carry in a union member; `StatusSubject` with `of === null` therefore satisfies
 * `PollableSubject` and fails `pollable()`. Same asymmetry `quantifiable()` above lives with, and
 * handled the same way — the predicate is the rule, the type is what a consumer may hold — and the
 * interpreter re-asserts it rather than assuming the parser ran (`execWaitUntilUi`'s final
 * `throw`). */
export type PollableSubject = LocatorSubject | PageSubject | NetworkRequestSubject | StatusSubject | HeaderSubject | BodySubject | BodyTextSubject;

export function pollable(subject: Subject): subject is PollableSubject {
  if (subject.type === 'LocatorSubject' || subject.type === 'PageSubject' || subject.type === 'NetworkRequestSubject') return true;
  // The `of request to "…"` clause moves the read off the response scope and onto the browser's
  // observed traffic, which grows while the page is live — so it is the clause, not the subject
  // keyword, that decides here. Tested by presence rather than by listing the four types that carry
  // it, so a fifth one gains this for free on the day it gains an `of`.
  return 'of' in subject && (subject as { of?: unknown }).of != null;
}

/** A UI locator used as an `expect`/`check` subject (`expect button "Add to cart" is visible`,
 * SPEC §9.4, M3a). Only the state/value/count matchers of §6.2 are meaningful against it.
 *
 * The value-comparison matchers (`equals`/`contains`/`matches`/…) are **not** rejected statically
 * here — `checkRequestAssertions` is the only matcher↔subject check that is (see its doc for the
 * admission test), and `ValueSubject`'s `TF041` is the second. A locator's incompatibilities are
 * still found at run time. */
export interface LocatorSubject extends Node {
  readonly type: 'LocatorSubject';
  readonly locator: Locator;
}

export interface StatusSubject extends Node {
  readonly type: 'StatusSubject';
  /** `of request to "…"` (M3d) — read this from an observed network request instead of the last
   * `api` step's response. `null` is today's unchanged behavior. */
  readonly of: NetworkRequestRef | null;
}

/** `request` — the connection attempt itself, not the response (SPEC §5.3/§6.2.2, PLAN decision
 * 18, enterprise arc cluster 5.5). Only meaningful with the `connects`/`fails` matchers; carries
 * no data of its own to navigate (unlike every other subject, which reads the response). Not to be
 * confused with `NetworkRequestSubject` below (`request to "<url>"`, M3d) — a lexically similar but
 * semantically distinct subject the parser disambiguates on whether `to` follows `request`. */
export interface RequestSubject extends Node {
  readonly type: 'RequestSubject';
}

/** `request to "<url-pattern>" [with method "<M>"]` (M3d, D14, SPEC §9.7) — targets a network
 * request observed on the active browser page during this test attempt, distinct from the
 * `api`-step-scoped `RequestSubject` above. Only meaningful with the `wasMade` matcher (existence:
 * has any matching request been observed so far). To read a matched request's status/body/header
 * instead of just asking whether it happened, attach the same `ref` as an `of request to "…"`
 * clause on `StatusSubject`/`HeaderSubject`/`BodySubject`/`BodyTextSubject` rather than duplicating
 * their machinery here. */
export interface NetworkRequestSubject extends Node {
  readonly type: 'NetworkRequestSubject';
  readonly ref: NetworkRequestRef;
}

/** Shared by `NetworkRequestSubject` and the `of request to "…"` clause (M3d, SPEC §9.7).
 * `urlPattern` is substring-matched against a captured request's full URL — deliberately not
 * Playwright's own glob syntax (that's `stub`'s job, StubStmt, which really does register a route
 * matcher); when several observed requests match, the most recently completed one wins. `method`,
 * when given, narrows the match to that HTTP method (case-insensitive). */
export interface NetworkRequestRef extends Node {
  readonly type: 'NetworkRequestRef';
  readonly urlPattern: StringLit;
  readonly method: StringLit | null;
}

export interface DurationSubject extends Node {
  readonly type: 'DurationSubject';
}

/** `page` (M3e, D14, SPEC §9.8) — the active browser page as a whole, not a specific locator.
 * Currently only meaningful with the `hasNoA11yViolations` matcher (`expect page has no [<severity>]
 * a11y violations`); a bare subject (like `RequestSubject`) rather than one carrying its own data,
 * since what it means depends entirely on which matcher follows — the same shape a future `page`
 * matcher (title/url) would reuse without a new subject type. */
export interface PageSubject extends Node {
  readonly type: 'PageSubject';
}

/** `response` (M128b, D290, SPEC §9.10) — the last `api` step's response *as a whole*, scanned
 * rather than addressed. Deliberately parallel to `PageSubject`: a bare subject carrying no data of
 * its own, whose meaning comes entirely from the matcher after it.
 *
 * **Why a new subject rather than a new matcher on an existing one.** SPEC §5.3's subjects
 * (`status`, `header "…"`, `body.…`) each name *one addressable part* of the response and compare
 * it against an operand. A hygiene scan reads the status line, every header, every `Set-Cookie` and
 * the request that produced them, and returns a list — there is no part to name and no operand to
 * compare against. `response` is the whole thing, which is what the scan actually takes.
 *
 * **Why not `security` as the subject** (the rejected alternative in D290): it keeps §5.3's subject
 * list closed, but it gives the scan a subject that is not a thing the run observed. `response` is.
 *
 * Not capturable (`TF053`) and not a value (`TF041`) — see `checkCapturableSubjects` and
 * `LIVE_HANDLE_MATCHERS` for both, which is the same pair of exclusions `page` already carries. */
export interface ResponseSubject extends Node {
  readonly type: 'ResponseSubject';
}

export interface HeaderSubject extends Node {
  readonly type: 'HeaderSubject';
  readonly name: StringLit;
  /** `of request to "…"` (M3d) — see `StatusSubject.of`. */
  readonly of: NetworkRequestRef | null;
}

export interface BodySubject extends Node {
  readonly type: 'BodySubject';
  /** Empty path = the whole body; otherwise dot/index segments (`body.items[0].price`). */
  readonly path: readonly PathSegment[];
  /** `of request to "…"` (M3d) — see `StatusSubject.of`. */
  readonly of: NetworkRequestRef | null;
}

/** `body text` — the raw response body as a string, for non-JSON (text/HTML/XML) responses
 * (SPEC §5.3, decision 51). Distinct from `BodySubject`, which requires a JSON response. */
export interface BodyTextSubject extends Node {
  readonly type: 'BodyTextSubject';
  /** `of request to "…"` (M3d) — see `StatusSubject.of`. */
  readonly of: NetworkRequestRef | null;
}

/** `body bytes` — the raw, untouched response body (gap #17, TFLW-GAPS.md), for binary responses
 * (PDF, image, etc.) that `body text` would otherwise irreversibly UTF-8-corrupt. Only `hasCount`
 * (byte length) and `matches file "<path>"` are meaningful matchers against it — see `MatcherName`
 * and `evaluateExpect`'s dedicated `matchesFile` dispatch. */
export interface BodyBytesSubject extends Node {
  readonly type: 'BodyBytesSubject';
}

/** `body csv` / `body csv[0].name` (gap #19, TFLW-GAPS.md) — the response body parsed as RFC 4180
 * CSV (header row required) into `Array<Record<string, string>>`, then addressed via the same
 * `path` machinery `BodySubject` already uses. Parsed lazily from `response.bodyText` inside
 * `resolveSubject`, not eagerly at request time. */
export interface BodyCsvSubject extends Node {
  readonly type: 'BodyCsvSubject';
  /** Empty path = the whole parsed array; otherwise dot/index segments, same as `BodySubject`. */
  readonly path: readonly PathSegment[];
}

/** `body pdf text` (gap #19, TFLW-GAPS.md) — text extracted from a PDF response body (walks the
 * `Pages` tree, inflates `/FlateDecode` content streams, reads `Tj`/`TJ`/`T*` operators). Flat
 * string subject, no path — pages join with a blank line, lines within a page join with `\n`. */
export interface BodyPdfTextSubject extends Node {
  readonly type: 'BodyPdfTextSubject';
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
  | 'matchesFile'
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
  | 'fails'
  | 'wasMade'
  | 'hasNoA11yViolations'
  | 'hasNoSecurityViolations'
  | 'hasNoAuthzViolations'
  | 'hasNoInputHandlingViolations'
  | 'matchesSnapshot';

/** The severity scale every *scan* in this language shares, increasing. Originally axe-core's own
 * `impact` scale (M3e, SPEC §9.8), adopted wholesale so that a second scanner would have four
 * buckets to map onto rather than a fifth ordering to invent (PLAN_BROWSER_PERF_SECURITY.md §1.10,
 * D14) — and `M128b`'s security pack is that second scanner, which is why this is no longer named
 * for a11y. Shared with `@tflw/runtime`'s `finding.ts`, which re-exports it as `Severity`. */
export type FindingSeverity = 'minor' | 'moderate' | 'serious' | 'critical';

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
  /** `matches file "<path>"` (gap #17) — set only when `name === 'matchesFile'`. A plain string
   * literal, never `{var}`-interpolated (same deliberate choice as `schemaName`/`schemaSource`:
   * read directly, never run through `evalValue`). Resolved against the test file's own directory
   * at runtime, same as `schemaSource`'s relative-path handling. */
  readonly filePath?: StringLit;
  /** The optional severity word in `has no [<severity>] a11y violations` (M3e) and `has no
   * [<severity>] security violations` (M128b) and `has no [<severity>] authorization violations`
   * (M130b, D304) — set only for those three matchers.
   *
   * `undefined` means every severity counts; otherwise a *floor* — `serious` also counts `critical`
   * findings, since a "no serious violations" bar that a worse violation could quietly slip under
   * would be a teaching trap, not a convenience.
   *
   * **One field, not one per scan.** It was `a11ySeverity` until `M128b`, when the security pack
   * arrived needing the identical word list, the identical floor semantics and the identical AST
   * position. A second field would have been a fork of this one — the shape `M125e` filed against a
   * display label derived from an identity key — so the field was renamed to what it has always
   * actually been. What differs between the scans is which *rules* the floor selects, and that
   * lives in each scanner, not here. `M130b`'s authorization pack is the third tenant and needed no
   * change at all, which is the renaming being paid back. */
  readonly severityFloor?: FindingSeverity;
  /** `matches snapshot "<name>"` (M4b, D15) — set only when `name === 'matchesSnapshot'`. Becomes
   * the baseline's file name (slugified) under `snapshots/<file>/<test>/<name>.png` — not a file
   * path itself, the same "display label, not a path" framing `ScreenshotStmt.name` already uses. */
  readonly snapshotName?: StringLit;
}

// ---- UI / browser steps (P#8-9, P#26, SPEC §9, M3a-M3e) ----------------------
//
// M3a shipped: open/click(+double/right)/fill/fill form/select/check/uncheck/press/hover/scroll/
// within + the state/value/count UI expect subjects + dialogs. M3b adds: frame traversal (`within
// frame <locator>`), tab/window switching (`switch to new tab`/`switch to tab N`/`close tab`),
// download capture (`download as <name>`), drag-drop (`drag … to …`/`drop file … onto …`), and
// `wait until <ui condition>`. M3c adds: `screenshot "<name>"`, automatic failure screenshots,
// Playwright trace-on-failure/retry, the `report/assets/` directory, `--browser`/`--headed`, and
// `viewport` config (D11, D12). M3d adds: network observation (`request to "…"`/`of request to
// "…"`) and `stub` route mocking. M3e adds: the `page` subject + `hasNoA11yViolations` matcher
// (axe-core). M4a is pure LSP/VS Code tooling catch-up (no new AST). M4b adds: the
// `matchesSnapshot` matcher (`page`/a `LocatorSubject` `matches snapshot "<name>"`, D15) and
// `ExpectStmt.masks` (`mask <locator>`). M5 (live-DOM diagnosis + `tflw pick`) and M6 (the reuse
// pass + `CallStmt`, see below) added no further Locator-related AST. Still deferred, no milestone
// owns it yet: `element <name> = <locator>` aliases (§8).

/** Locator noun (D6, SPEC §9.3): the noun picks the resolution strategy — `button`/`text`/`list`
 * single-strategy, `field` a closed 3-step cascade (label → placeholder → role), `css`/`xpath`
 * escapes. `element` aliases are not yet implemented (deferred, see note above). */
export type LocatorKind = 'button' | 'field' | 'text' | 'list' | 'css' | 'xpath';

export interface Locator extends Node {
  readonly type: 'Locator';
  readonly kind: LocatorKind;
  /** Accessible name / visible text for `button`/`field`/`text`/`list`; the raw selector string
   * for `css`/`xpath`. `{ref}`-interpolation-aware like any other `StringLit`. */
  readonly value: StringLit;
}

/** `open "/orders/{orderId}"` — relative to the env's `web` base URL (SPEC §3.1, §9.1). A quoted
 * `StringLit` (not a bare api-style path token — `open` has no method/service prefix to gate a
 * contextual `/`, so it stays a normal, already-interpolation-aware string). */
export interface OpenStmt extends Node {
  readonly type: 'OpenStmt';
  readonly path: StringLit;
}

/** `screenshot "checkout-step-2"` (M3c, SPEC §13) — captures the active page unconditionally
 * (unlike the automatic failure screenshot, which only fires when a step fails). The name becomes
 * the asset's display label in the report; not a file path. */
export interface ScreenshotStmt extends Node {
  readonly type: 'ScreenshotStmt';
  readonly name: StringLit;
}

/** `stub <METHOD> "<url-pattern>" respond status <code> [body {...}]` (M3d, D14, SPEC §9.7) —
 * route-level response mocking for the active browser page's network traffic. `urlPattern` is
 * Playwright's own glob/regex route-matching syntax, not a tflw-owned pattern language — no reason
 * to reinvent one. Registered for the rest of the attempt from wherever it appears in the test; a
 * request whose method doesn't match this stub falls through to the real network untouched. House
 * style (SPEC §9.7): real fixtures by default — `stub` is for third-party/unavailable dependencies,
 * not a general test-double substitute for a real fixture. */
export interface StubStmt extends Node {
  readonly type: 'StubStmt';
  readonly method: HttpMethod;
  readonly urlPattern: StringLit;
  readonly status: NumberLit;
  /** The stubbed response document — an object or a **top-level array** (`M147d`, `A3-12`, D639).
   *  A list endpoint answers with an array, so this was the narrower of the two `body` positions in
   *  practice even though `A3-12` named the other one. */
  readonly body: ObjectLit | ArrayLit | null;
}

export type ClickKind = 'single' | 'double' | 'right';

/** `click button "Add to cart"` / `double click …` / `right click …` (SPEC §9.1). */
export interface ClickStmt extends Node {
  readonly type: 'ClickStmt';
  readonly kind: ClickKind;
  readonly locator: Locator;
}

/** `fill field "Email" with {email}` (SPEC §9.1). */
export interface FillStmt extends Node {
  readonly type: 'FillStmt';
  readonly locator: Locator;
  readonly value: Value;
}

/** `fill form` + an indented table (SPEC §9.2). Each row's left cell is a `field` name (same
 * resolution as a bare `fill field`); each row executes and reports as its own sub-step. */
export interface FillFormStmt extends Node {
  readonly type: 'FillFormStmt';
  readonly rows: readonly FillFormRow[];
}

export interface FillFormRow extends Node {
  readonly type: 'FillFormRow';
  readonly field: StringLit;
  readonly value: Value;
}

/** `select "Widget" from field "Size"` — chooses an option by its visible text/value. */
export interface SelectStmt extends Node {
  readonly type: 'SelectStmt';
  readonly locator: Locator;
  readonly value: Value;
}

/** `tick field "Accept terms"` — ticks a checkbox/radio (FS-04).
 *
 * The keyword used to be `check`, which is also the soft-assertion keyword, and the parser
 * disambiguated on whether a matcher followed the subject — matcher ⇒ `ExpectStmt(soft: true)`,
 * none ⇒ this node. That was silent: `check text "Order placed"`, written by someone whose model is
 * "`check` is the soft `expect`", produced a checkbox tick against a text node with no diagnostic
 * (`A3-07`). `check` is now purely the soft assertion; the action is `tick`/`untick`. Playwright and
 * Cypress both spell it `check()`, so the migration diagnostic is the teaching surface for anyone
 * arriving from either. */
export interface TickStmt extends Node {
  readonly type: 'TickStmt';
  readonly locator: Locator;
}

/** `untick field "Accept terms"` — the counterpart to `tick`, never ambiguous with anything (there
 * has never been an `untick`/`uncheck` matcher), always an action. */
export interface UntickStmt extends Node {
  readonly type: 'UntickStmt';
  readonly locator: Locator;
}

/** `press "Enter"` (page-level) or `press "Enter" on field "Search"` (locator-scoped, preferred
 * when the key should be typed into a specific control). Supports chords (`"Control+A"`). */
export interface PressStmt extends Node {
  readonly type: 'PressStmt';
  readonly keys: StringLit;
  readonly locator: Locator | null;
}

/** `hover button "Menu"` (SPEC §9.1). */
export interface HoverStmt extends Node {
  readonly type: 'HoverStmt';
  readonly locator: Locator;
}

/** `scroll to list "Cart items"` — scrolls the locator into view (SPEC §9.1). */
export interface ScrollStmt extends Node {
  readonly type: 'ScrollStmt';
  readonly locator: Locator;
}

/** `within <locator>` + an indented step block — scopes every nested step's locator resolution to
 * inside this container (D7, SPEC §9.3), the same indented-block shape every other construct in
 * the language uses (test/action/hook bodies) rather than inventing brace syntax. Block form only,
 * no inline `in` suffix (frozen additive-only so one can be added later without breaking this).
 * `within frame <locator>` (M3b, SPEC §9.5) sets `frame: true` — the container locator must
 * resolve to exactly one `<iframe>` element, and nested steps resolve *inside that frame's own
 * document* (via Playwright's `Locator.contentFrame()`), not merely inside a container element on
 * the same page like the ordinary (non-frame) form. */
export interface WithinBlock extends Node {
  readonly type: 'WithinBlock';
  readonly locator: Locator;
  readonly frame: boolean;
  readonly body: readonly Step[];
}

/** `accept dialog` / `dismiss dialog` — arms a one-shot handler for the *next* native dialog
 * (`confirm`/`alert`/`prompt`) raised by the step(s) that follow, so a `confirm()`-guarded action
 * doesn't silently no-op the way Playwright's own default auto-dismiss would (SPEC §9.1, decision
 * D8's mandatory dialog handling). */
export interface AcceptDialogStmt extends Node {
  readonly type: 'AcceptDialogStmt';
  /** `accept dialog with "<text>"` — the answer typed into a `prompt` (`D800`, M159c). `with` is
   * already this language's argument-carrying preposition (`fill field "Email" with {email}`), so
   * this borrows an established reading rather than inventing one, and interpolation works for the
   * same reason it does there. Absent on `accept dialog`, whose behaviour is unchanged: accept with
   * the empty string. Only `accept` takes it — there is nothing to answer a dialog *with* while
   * dismissing it. Reaching a non-`prompt` is `TF080`, at runtime (`D801`): the kind is not
   * knowable statically, and Playwright's own `promptText` is silently ignored there. */
  readonly text?: Value;
}

export interface DismissDialogStmt extends Node {
  readonly type: 'DismissDialogStmt';
}

/** `switch to new tab` + an indented step block (SPEC §9.5, M3b) — the block's step(s) are
 * expected to trigger a new tab/window to open (e.g. clicking a `target="_blank"` link); the
 * runtime starts listening for the browser context's next `page` (popup) event *before* running
 * the block (so it can't miss a fast-opening tab), then makes the new tab the active one for every
 * step after this block. Unlike `within`, this scoping is **not** transient — it persists past the
 * block, the way switching tabs in a real browser does, until another `switch to`/`close tab`. */
export interface SwitchToNewTabBlock extends Node {
  readonly type: 'SwitchToNewTabBlock';
  readonly body: readonly Step[];
}

/** `switch to tab N` (1-based, in the order tabs were opened) — switches the active tab directly,
 * no event to wait for since the tab already exists (SPEC §9.5, M3b). */
export interface SwitchToTabStmt extends Node {
  readonly type: 'SwitchToTabStmt';
  readonly index: number;
}

/** `close tab` — closes the active tab and switches back to the previous one in open order (index
 * - 1, floor 0). Closing the last remaining tab is a runtime error, not a silent no-op (SPEC §9.5,
 * M3b) — a test that meant to end up back on the main tab should know if there wasn't one. */
export interface CloseTabStmt extends Node {
  readonly type: 'CloseTabStmt';
}

/** `download as <name>` + an indented step block (SPEC §9.5, M3b) — like `switch to new tab`,
 * wraps the triggering step(s) so the runtime can start listening for the active page's `download`
 * event before running them. Captures the download's suggested filename as a plain string bound to
 * `name`; the actual file bytes/on-disk path aren't yet surfaced as report artifacts — that lands
 * with M3c's `report/` directory. */
export interface DownloadBlock extends Node {
  readonly type: 'DownloadBlock';
  readonly name: string;
  readonly body: readonly Step[];
}

/** `drag <locator> to <locator>` (SPEC §9.5, M3b) — reorders/moves an element via a native HTML5
 * drag-and-drop sequence (`dragstart`/`dragenter`/`dragover`/`drop`/`dragend` dispatched directly
 * with a real `DataTransfer`, not Playwright's own `dragTo()` mouse simulation — testFlow-tests'
 * webV2-3 build found `dragTo()` doesn't reliably fire native DnD listeners in headless Chromium,
 * while direct `DragEvent` dispatch does). */
export interface DragStmt extends Node {
  readonly type: 'DragStmt';
  readonly from: Locator;
  readonly to: Locator;
}

/** `drop file "./f.png" onto <locator>` (SPEC §9.5, M3b) — simulates a native file drop onto a
 * dropzone element that has no underlying `<input type="file">` for `upload`/`setInputFiles` to
 * target. Reads the file's real bytes on the host, builds an in-page `DataTransfer` carrying an
 * actual `File` (not a fake), then dispatches `dragenter`/`dragover`/`drop` on the target. */
export interface DropFileStmt extends Node {
  readonly type: 'DropFileStmt';
  readonly filePath: StringLit;
  readonly locator: Locator;
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

// ---- Logging (M27, PLAN_LOG.md) --------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** `to console|html|both` — where a `log` line ends up. Grammar-level only: `none` (a global
 * kill-switch for bare calls, `--log-output none`) exists only as a CLI/`ResolvedConfig` value,
 * never a valid `to` target here (PLAN_LOG.md decision 121). */
export type LogDestination = 'console' | 'html' | 'both';

/** `log [debug|info|warn|error] "message with {var}" [to console|html|both]` (M27, PLAN_LOG.md
 * decisions 113-120). Unlike every other step, a `log` call is unconditional author signal, not
 * step-execution plumbing (decision 118) — it always succeeds and always produces a report step,
 * regardless of its `destination`/level (decision 119: renderers filter, execution never does).
 * `level` defaults to `'info'` when omitted (decision 114); `destination` is `null` when the `to`
 * clause is omitted, meaning "use `tflw.config`'s `logDestination` (itself defaulting to `both`,
 * decision 116) at run time" — resolved by the interpreter, not the parser, since the config isn't
 * in scope here. `message` is an ordinary `StringLit`, so `{var}` interpolation (decision 120) and
 * unknown-variable checking (`checkStringLit`) both come for free, the same as every other
 * string-bearing step. */
export interface LogStmt extends Node {
  readonly type: 'LogStmt';
  readonly level: LogLevel;
  readonly message: StringLit;
  readonly destination: LogDestination | null;
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
  /** The literal as written — `500ms`, `10s`. Kept for the same reason `NumberLit` and
   *  `ReportDecl.dir` keep theirs (`A2-12`): `ms` alone cannot be quoted back to the author, and
   *  `M147d` needed exactly that when `today - 10s` became a bound `TF054` can read — a hint saying
   *  ``write `random date between today - 10000 and today` `` names a program nobody wrote. */
  readonly raw: string;
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
  readonly excludes: readonly ExcludeDecl[];
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
  /** `session <name> for env <a>[, <b>...]` (`M147d`/`M137f-02`, D642) — the envs this session is
   * declared for, or `null` for a session written without the clause.
   *
   * **`null` means every env, and that is what keeps this additive.** A `session` was env-independent
   * from P#20 until here, so every session that already exists parses to `null` and resolves exactly
   * as it did. The clause only ever *narrows*.
   *
   * Refs rather than bare strings, unlike `RequireDecl.names`: `checkSessions`' rule is one
   * diagnostic per unknown name rather than one aggregated per site, and that rule needs a span per
   * name to point at. It is also the preference `ReportDecl.dir` states for its own field (`A2-12`)
   * — keep the position, flatten at the point of use. */
  readonly envs: readonly EnvScopeRef[] | null;
  readonly oauth2: Oauth2SessionConfig | null;
  readonly body: readonly Step[];
  /** `session <name> [oauth2] privileged` (M130b, D307/D310) — this principal is *supposed* to be
   * able to read other principals' resources, so `has no authorization violations` excludes it from
   * the probe set instead of reporting the access it is entitled to as a finding.
   *
   * **A claim about authority, not a performance lever.** Marking every session privileged empties
   * the probe set and is refused by the checker, precisely because the cheapest way to make a slow
   * authz assertion fast would otherwise be to declare away the thing it measures. The lever for
   * cost is fewer assertion sites. */
  readonly privileged: boolean;
}

/** One env-block name from a `session ... for env` clause (`M147d`, D642). A node rather than a
 * string so the unknown-env diagnostic can underline the name that is wrong instead of the whole
 * declaration — a `session` span runs to the end of its indented body, which for a five-step login
 * is a diagnostic pointing at a paragraph to complain about a word.
 *
 * **`EnvScopeRef` and not `EnvRef`, because `EnvRef` is already this file's name for `env(NAME)`** —
 * an *operating-system* environment variable, and a `Value`. That collision is the clearest evidence
 * for the note on `SessionDecl.envs`: the two meanings of the word predate this clause and had
 * already reached the type names. This one is the block `env <name>` declares and `--env` selects. */
export interface EnvScopeRef extends Node {
  readonly type: 'EnvScopeRef';
  readonly name: string;
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
  | AuthorizedTargetDecl
  | EvidenceDecl
  | TeardownDecl
  | RedactDecl
  | ViewportDecl
  | LogDestinationDecl
  | LogLevelDecl;

export interface HeaderDecl extends Node {
  readonly type: 'HeaderDecl';
  readonly name: StringLit;
  readonly value: Value;
  /** `… for <service>` scoping, or null for all services (P#29). */
  readonly service: string | null;
  /** `M147f` (`M147-07`) — where `service` was written, or null when the clause is absent. A bare
   *  string cannot be pointed at, which is the same reason `SessionDecl.envs` carries `EnvScopeRef`
   *  nodes rather than names (`D642`): the scope clause is a place a typo lands, and a typo needs a
   *  caret. `TF076` is the diagnostic that uses it. */
  readonly serviceSpan: Span | null;
}

/** The five config timeout targets, in two families (`D770`).
 *
 * **Budget targets** — `step`, `api`, `browser` — are handed to an operation as its abort deadline,
 * so `0` makes every such operation fail before it does anything (`TF071`). **Poll targets** —
 * `expect`, `wait` — are ceilings tested *after* a read, so `0` legitimately means "evaluate once,
 * don't poll".
 *
 * `api` and `browser` **narrow** `step` rather than replacing it (`D768`, `M155a`): a site reads
 * its own transport's key if one was written and `step` otherwise, which is why `step` survives in
 * the grammar and not in `ResolvedTimeouts` (`D769`). */
export type TimeoutTarget = 'step' | 'api' | 'browser' | 'expect' | 'wait';

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
  /** The `StringLit`, not its flattened `.value` (M74, review finding A2-12). Every sibling path
   * directive — `CertDecl.path`, `KeyDecl.path`, `WebDecl.url`, `ApiServiceDecl.url`,
   * `ExcludeDecl.paths`, `HeaderDecl.name` — keeps one; this alone discarded it, and `ast.ts` is
   * re-exported wholesale from `index.ts`, so `dir: string` was about to freeze as public API with
   * the string's `parts` gone. Keeping the literal is what leaves `report "./out-{BUILD_ID}"`
   * reachable later; today, like every other config path, it resolves by `.value` and does not
   * interpolate. */
  readonly dir: StringLit;
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

/** `authorized target "<url>" reason "<text>"` (M128b, D291, SPEC §3.10) — D21's declaration layer,
 * and the gate on every security assertion in the suite.
 *
 * **Named, never a wildcard.** `allow hosts` accepts `*.example.com` because its job is to bound
 * where a suite may send *ordinary* traffic, and a bound with a pattern in it is still a bound.
 * This declaration's job is different: it is an author affirming, in writing, that they are
 * permitted to point a security scanner at a specific host. A pattern cannot make that affirmation
 * — nobody is authorized to scan `*.com` — so the checker rejects one rather than accepting a claim
 * whose scope its author could not have known. That rejection is `TF061`.
 *
 * **`reason` is required, and is the point.** It is not documentation of the config; it is the
 * sentence that gets printed in the CLI summary and embedded in the report, so every artifact a run
 * produces records what was claimed and by whom it was written. A declaration with no reason would
 * be a checkbox, and a checkbox is what D21 exists instead of.
 *
 * Accumulates across `defaults` + `env` exactly as `allow hosts` does (SPEC §3.7's composition
 * rule): a suite that scans one host in every env declares it once in `defaults`. */
export interface AuthorizedTargetDecl extends Node {
  readonly type: 'AuthorizedTargetDecl';
  readonly target: StringLit;
  readonly reason: StringLit;
  /** The optional indented `probe mutating` sub-clause (M130b, D311/D330) — permission for
   * `has no authorization violations` to re-issue a `POST`/`PUT`/`PATCH`/`DELETE` under another
   * principal against *this host*. Without it a mutating step's assertion reports `not probed`
   * rather than silently sending writes somewhere nobody said it could.
   *
   * A property of the host, not of the run: staging may be safe to read as a stranger and not safe
   * to write to. The one-line `authorized target "<url>" reason "<text>"` form above is unchanged —
   * this is a line *beneath* it, never a reformatting of it. */
  readonly probeMutating: boolean;
  /** `probe oversized` (M134a, D372) — permission for `has no input handling violations` to send a
   * 64 KiB value at this host's inputs. Opt-in because D21 layer 4 names **resource exhaustion**
   * explicitly, and a megabyte-shaped string against an unbounded field is that class by name.
   *
   * D311 predicted this exact landing — *"Tier 3's further per-class opt-ins land as sibling lines
   * instead of needing a second grammar"* — so layer 4 is **discharged and stays discharged**:
   * `probe mutating` was its first tenant, and these two are the second and third tenants of a
   * working mechanism rather than a reopening of the layer. */
  readonly probeOversized: boolean;
  /** `probe traversal` (M134a, D372) — permission to send `../`-shaped payloads at this host's
   * inputs. Detection-oriented (it attempts a read, never a write), but it is still an attempt at
   * unauthorized access, which is the other thing D21 layer 4 names. */
  readonly probeTraversal: boolean;
  /** `probe ciphers` (M137g, D485/D486) — permission to open **one handshake per candidate suite**
   * against this host, so `sec/tls-weak-cipher` can judge what the host *offers* rather than only
   * what it gave tflw's own client.
   *
   * The fourth tenant of the mechanism `D311` predicted, and it has to be a tenant: `D21` layer 4
   * names **resource exhaustion**, and this is the arc's first construct whose entire purpose is
   * many connections to one host. Every other probe clause governs what a request may *contain*;
   * this one governs how many connections may be opened, which is why it is a property of the host
   * and not of any one assertion. */
  readonly probeCiphers: boolean;
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

export type TeardownLevel = 'always' | 'on-success' | 'never';

/** `teardown always|on success|never` (`M157d`, `D783`) — when a workload's `after` hooks run
 * after an iteration: after all of them, only after the ones that passed, or after none. Overrides
 * like `evidence`/`insecure` (env wins over `defaults`), and `--teardown` overrides this at the CLI
 * for one run. Default `'always'` (`D781`).
 *
 * **Workload-only** (`D784`). Functional `after` hooks run unconditionally whatever this says: the
 * key exists for forensic access to a load run's residue, and letting a config key switch off
 * inter-test isolation is a different and much worse power than the one being added.
 *
 * The tree carries `'on-success'` while the source spells it `on success` — two bare words, no
 * hyphen, because this language has zero hyphenated bare keywords (`D628`/`M134a`). That is
 * `EvidenceLevel`'s arrangement exactly, where `headers only` carries as `'headers-only'`.
 *
 * `on success` reads the **iteration's** verdict, never the run's. A breached `threshold` is a
 * run-level verdict decided after every iteration has finished, and therefore after teardown has
 * already run; covering that would need teardown deferred and buffered, which is a different
 * mechanism rather than a fourth value. */
export interface TeardownDecl extends Node {
  readonly type: 'TeardownDecl';
  readonly level: TeardownLevel;
}

/** `log destination console|html|both` (M27, PLAN_LOG.md decision 116; bare keywords since
 * `M147b`/`D623`) — the default a bare
 * `log "…"` (no `to` clause) resolves to. Override semantics like `evidence`/`insecure` (env wins
 * over `defaults`), default `'both'` when never declared. */
export interface LogDestinationDecl extends Node {
  readonly type: 'LogDestinationDecl';
  readonly destination: LogDestination;
}

/** `log level debug|info|warn|error` (M27, PLAN_LOG.md decision 122; bare keywords since
 * `M147b`/`D623`) — the minimum level a
 * `log` step must clear to be *rendered* (console text, `report.html`); never affects whether a
 * step is *recorded* (`results.json`/ndjson always carry every log step, decision 119/122). Same
 * override semantics as `evidence`, default `'debug'` (show everything) when never declared. */
export interface LogLevelDecl extends Node {
  readonly type: 'LogLevelDecl';
  readonly level: LogLevel;
}

/** `viewport 1280 720` — browser window size in px, width then height (M3c, SPEC §9, D11). Same
 * override semantics as `insecure`/`workers` (env wins over `defaults`), `defaults`-only (like
 * `workers`/`report` — a run-level browser setting, not one that should vary per env). Omitted:
 * Playwright's own default (1280×720) applies. */
export interface ViewportDecl extends Node {
  readonly type: 'ViewportDecl';
  readonly width: number;
  readonly height: number;
}

/** A single `redact` target's path below `body`: one or more `.prop`/`.* ` segments. Deliberately
 * a separate, minimal path type from `PathSegment` (used by `expect`/`capture`) — those never
 * need wildcards and shouldn't silently gain them just because `redact` does. */
export type RedactPathSegment = { readonly kind: 'prop'; readonly name: string } | { readonly kind: 'wildcard' };

/**
 * What one `redact` entry names. FS-03 (review findings FU-01/V2-06) widened this from `body`-only:
 * the fresh-user pass found `report.html` and `results.json` each carrying 24 live JWTs while the
 * footer called the artifact safe to attach to a ticket — and those JWTs were in **headers**, which
 * `redact` had no way to name at all.
 *
 * A discriminated union rather than one shape with an optional path, because a header or query
 * parameter is a *name*, not a path: there is nothing below `Authorization` to descend into, so no
 * consumer should be able to hand it a `segments` array by accident.
 *
 * Header and query names are quoted strings (`redact header "X-Api-Key"`), not dotted identifiers.
 * That is both the spelling every other header-name site in the language already uses
 * (`header "Accept" is …`, `expect header "content-type" …`, `capture header "location" as …`) and
 * the only one that works: `isIdentCont` is `/[A-Za-z0-9_]/`, so a bare `header.X-Api-Key` lexes as
 * three tokens, and the real-world headers worth redacting — `X-Api-Key`, `Set-Cookie`,
 * `x-auth-token` — are precisely the hyphenated ones. Matching is case-insensitive, as HTTP header
 * names are; the literal name `"*"` matches every header/parameter, mirroring `body.*`.
 */
export type RedactPattern =
  | { readonly root: 'body'; readonly segments: readonly RedactPathSegment[] }
  | { readonly root: 'header'; readonly name: string }
  | { readonly root: 'query'; readonly name: string };

/** `redact body.email, header "Authorization", query "token"` — masks matching JSON fields,
 * response/request headers and URL query parameters with `[redacted]` in the report-only trace
 * before it's written (SPEC §3.4, PLAN decision 101d, enterprise arc cluster 2; widened beyond
 * `body` by FS-03). Accumulates across `defaults` + `env`, same as `AllowHostsDecl`.
 *
 * Related to but distinct from the taint-based secret redaction (`env(...)` values, `redact.ts`):
 * that one follows a *value* wherever it flows, this one masks a *position*. FS-03 connects them —
 * a `capture` whose subject is covered by one of these patterns registers its value with the
 * taint redactor, so naming a position here now also means "this value is a secret" and it gets
 * masked wherever it later reappears (a URL, a log line, another step's detail text). */
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

/** `exclude "<path>"[, "<path>"...]` — paths, relative to this config's own directory, that bare
 * (no-file-args) discovery must never descend into (D127, PLAN_DISCOVERY_EXCLUDE.md). Additive to
 * discovery's existing dot-dir/`node_modules` skip; an explicit file arg inside an excluded path
 * still runs. */
export interface ExcludeDecl extends Node {
  readonly type: 'ExcludeDecl';
  readonly paths: readonly StringLit[];
}
