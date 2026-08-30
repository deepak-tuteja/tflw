// Taint redaction (PLAN P#30). Every value read via `env(NAME)` is registered here with its
// concrete value; anywhere that concrete value later appears — request header, body, URL, or
// derived interpolation — it is rendered `•••(NAME)`. Value-based redaction (rather than
// header-blocklists) means a secret in a login body or a URL is caught wherever it flows, so
// report.html and CLI output are ticket-attachable by construction.

import { exhaustiveEntry, type AttemptResult, type CrawlResult, type ReportEntry, type RequestTrace, type ResponseTrace, type RunEvent, type RunReport, type RuntimeWarning, type StepResult, type TestResult, type WorkloadTestResult } from './types.js';

/** A secret shorter than this is too likely to collide with unrelated report content (a port
 * number, a small numeric ID) — substring-redacting it would silently corrupt those unrelated
 * fields instead of hiding a credential (decision 64). Below this floor, the value simply isn't
 * registered for substring replacement. */
export const MIN_REDACTABLE_LENGTH = 6;

export class Redactor {
  /** Concrete secret value → every placeholder name registered for it. Longest values first when
   * replacing. Tracking *all* names (decision 72) rather than only the first registrant matters
   * when two different `require env` vars (or an env var and a coincidentally-equal generated/test
   * value) happen to share the same string — silently keeping only the first name would mislead a
   * reader about which credential is actually in play, even though nothing is ever leaked either way. */
  private readonly secrets = new Map<string, string[]>();

  /** Names declared secret whose value was non-empty but below `MIN_REDACTABLE_LENGTH`, so nothing
   * was registered for them (review finding `A12-01`). Decision 64's floor is right — substring-
   * replacing a 4-character value would corrupt unrelated report content rather than hide a
   * credential — but until this set existed the trade-off was taken *silently*: the tool knew the
   * value had been declared a secret, knew it had chosen not to protect it, and reported success.
   * Insertion-ordered and deduplicated, surfaced by the CLI summary and `report.html`'s header the
   * same way `insecure: true` is. Empty values are deliberately absent: there is nothing to hide,
   * so naming one would be noise, not a warning. */
  private readonly tooShortToMask = new Set<string>();

  /** Register that `value` entered via `env(name)` — or, at the fourth call site, that a `capture`
   * whose subject a `redact` pattern covers produced it. Empty values, and values shorter than
   * `MIN_REDACTABLE_LENGTH` (decision 64), are ignored — nothing to hide, or too short to hide
   * safely; the latter are recorded in `tooShortToMask` so the run can say so out loud. Also
   * registers the value's JSON-string-body encoding (quotes/backslashes/newlines escaped) — a
   * secret embedded in a `body { … }` object is serialised through `JSON.stringify` before it ever
   * reaches `redact()`, so a secret containing any of those characters would otherwise appear in
   * its escaped form and dodge a plain substring match (P#46). */
  register(name: string, value: string): void {
    if (value.length < MIN_REDACTABLE_LENGTH) {
      if (value.length > 0) this.tooShortToMask.add(name);
      return;
    }
    this.addName(value, name);
    const jsonEscaped = JSON.stringify(value).slice(1, -1);
    if (jsonEscaped !== value) this.addName(jsonEscaped, name);
  }

  /** The names from `tooShortToMask`, for the run-level warning. A name that was *also* registered
   * with a maskable value under a different `env`/`capture` is excluded: the same name carrying two
   * values in one run (a `capture` inside a loop, say) is protected wherever the long one flows,
   * and warning about it would point a reader at a name that is in fact masked in the report they
   * are holding. */
  unmaskableNames(): string[] {
    const registered = new Set(this.entriesLongestFirst().flatMap(([, names]) => names));
    return [...this.tooShortToMask].filter((name) => !registered.has(name));
  }

  private addName(value: string, name: string): void {
    const names = this.secrets.get(value);
    if (!names) this.secrets.set(value, [name]);
    else if (!names.includes(name)) names.push(name);
  }

  /** Replace every occurrence of a registered secret in `text` with its `•••(NAME)` placeholder —
   * `•••(NAME1|NAME2)` when more than one env var shares that exact value. */
  redact(text: string): string {
    if (this.secrets.size === 0) return text;
    let out = text;
    for (const [value, names] of this.entriesLongestFirst()) {
      if (value && out.includes(value)) out = out.split(value).join(`•••(${names.join('|')})`);
    }
    return out;
  }

  private entriesLongestFirst(): [string, string[]][] {
    return [...this.secrets.entries()].sort((a, b) => b[0].length - a[0].length);
  }
}

/**
 * A final, full-report redaction pass (decision 56) — closes the *ordering* window that per-step
 * redaction leaves open: a step's trace is redacted with whatever the redactor knows *at the
 * moment that step runs*, so a secret first read late in a run (its `env(NAME)` isn't evaluated
 * until then) never retroactively masks an earlier step whose trace already contained that value.
 * Re-running `redact()` here, with the fully-populated redactor from the *entire* run (every file,
 * decision 56's other half is pre-registering every `require env` var up front so most secrets are
 * already known from the start), catches anything still unmasked. Idempotent: `redact()` no longer
 * finds an already-replaced `•••(NAME)` placeholder, so re-redacting a report that's already fully
 * masked is a harmless no-op.
 */
export function redactReport(report: RunReport, redactor: Redactor): RunReport {
  return { ...report, tests: report.tests.map((t) => redactReportEntry(t, redactor)) };
}

/**
 * The same final pass, for one `RunEvent` (M63, review finding V2-02). `report/events.ndjson` is a
 * *persisted* artifact, not the live stream: the CLI collects every event as it is emitted and
 * writes the file only after the run is over — at which point the redactor is fully populated and
 * the exact same ordering window `redactReport` closes for report.html/results.json can be closed
 * here too. Without this the file contradicted itself, masking a secret in its `run:end` line
 * (which carries the already-redacted `RunReport`) while printing it raw in the `step:end`/
 * `test:end` lines above, and `--format ndjson` is precisely the mode whose output is meant to be
 * shipped into another system.
 *
 * The live stdout stream is *not* fixable this way and deliberately isn't touched: a line is
 * already gone by the time a later `env()` reveals the secret. Idempotent for the same reason
 * `redactReport` is — an event that was already masked at emit time re-redacts to itself.
 */
export function redactEvent(event: RunEvent, redactor: Redactor): RunEvent {
  switch (event.type) {
    // `total` is a count and `env` is a `tflw.config` env-block name — neither is ever built from
    // an interpolated value, which is why `redactReport` doesn't redact `RunReport.env` either.
    case 'run:start':
      return event;
    case 'test:start':
      return { ...event, name: redactor.redact(event.name) };
    case 'step:end':
      return { ...event, test: redactor.redact(event.test), step: redactStepResult(event.step, redactor) };
    // M88d (`B3-11`): `result` is a `ReportEntry` now — a workload test emits a pair like any
    // other test, and its result has metrics where a functional one has steps. Same dispatch
    // `redactReport` already makes over `report.tests`, reusing the same helper.
    case 'test:end':
      return { ...event, result: redactReportEntry(event.result, redactor) };
    case 'run:end':
      return { ...event, report: redactReport(event.report, redactor) };
  }
}

function redactReportEntry(t: ReportEntry, redactor: Redactor): ReportEntry {
  // M56 (Phase 3): a workload test has no step timeline/request-response evidence to redact (D24a
  // — a load iteration's body executes silently, only aggregate metrics are kept) — only its own
  // name could ever carry a secret. A test header is never interpolated, so that means an author
  // who typed the value into the name itself; the redactor is value-based (see this file's header),
  // so it is masked all the same once some step reveals the value via `env()`.
  //
  // D462 — exhaustive, and this is the site where a missed kind is a *disclosure* rather than a
  // cosmetic gap: the fallback arm is the functional redactor, which knows how to walk a step
  // timeline and nothing else. A third kind carrying evidence of its own shape would be handed to it
  // and pass through with whatever it does not recognise unredacted.
  switch (t.kind) {
    case 'workload':
      return redactWorkloadTestResult(t, redactor);
    case 'functional':
      return redactTestResult(t, redactor);
    case 'crawl':
      return redactCrawlResult(t, redactor);
    default:
      return exhaustiveEntry(t);
  }
}

/** `M137c`. A crawl's evidence is a step timeline, so it redacts like a functional test's — and it is
 *  the kind that most needs it: every request in it was composed by tflw while carrying a declared
 *  session's real credential, so its `api` steps hold exactly the headers this pass exists for.
 *
 *  `surface`'s counts pass through untouched — a substring redactor applied to an integer is how a
 *  report ends up saying `[redacted] discovered` — but its one string does not. A seed's `source` is a
 *  resolved document URL, and a base URL assembled from `env(…)` can carry a token in it, so it goes
 *  through the same pass every other URL in the report does. */
function redactCrawlResult(t: CrawlResult, redactor: Redactor): CrawlResult {
  return {
    ...t,
    name: redactor.redact(t.name),
    ...(t.error !== undefined ? { error: redactor.redact(t.error) } : {}),
    steps: t.steps.map((s) => redactStepResult(s, redactor)),
    surface: {
      ...t.surface,
      seeds: t.surface.seeds.map((s) => (s.source === undefined ? s : { ...s, source: redactor.redact(s.source) })),
    },
  };
}

function redactWorkloadTestResult(t: WorkloadTestResult, redactor: Redactor): WorkloadTestResult {
  return { ...t, name: redactor.redact(t.name) };
}

function redactTestResult(t: TestResult, redactor: Redactor): TestResult {
  return {
    ...t,
    name: redactor.redact(t.name),
    ...(t.error !== undefined ? { error: redactor.redact(t.error) } : {}),
    steps: t.steps.map((s) => redactStepResult(s, redactor)),
    ...(t.warnings ? { warnings: t.warnings.map((w) => redactWarning(w, redactor)) } : {}),
    ...(t.attempts ? { attempts: t.attempts.map((a) => redactAttemptResult(a, redactor)) } : {}),
  };
}

/** `M159d` — a `RuntimeWarning` carries two strings written from the program, and `TF080`'s quotes
 * the answer a dialog threw away. `accept dialog with env(TOKEN)` is the ordinary shape of a login
 * behind a `prompt`, so that answer is exactly the kind of value the rest of this pass exists to
 * mask — and until this line the field spread through `...t` unredacted into `results.json`,
 * `report.html` and the CLI summary, in a report where every other string was masked. Found by
 * measurement rather than review, one milestone after the channel was built: this is the shape of
 * `V2-02` and of this file's own header warning about *"every field added afterwards"*, and a new
 * field on a reported type is the moment to re-read both. `code` and `line` are structural. */
function redactWarning(w: RuntimeWarning, redactor: Redactor): RuntimeWarning {
  return { ...w, message: redactor.redact(w.message), source: redactor.redact(w.source) };
}

/** Every attempt's steps must be redacted too, not just the kept/final one — otherwise a secret
 * that only appeared in a previously-discarded failing attempt would now ship unmasked once that
 * attempt becomes visible in the report (PLAN decision 86). The final attempt's `StepResult`
 * objects are shared with `t.steps` (same array reference); redacting them twice is a documented
 * no-op (see this file's header comment), not a bug. */
function redactAttemptResult(a: AttemptResult, redactor: Redactor): AttemptResult {
  return {
    ...a,
    ...(a.error !== undefined ? { error: redactor.redact(a.error) } : {}),
    steps: a.steps.map((s) => redactStepResult(s, redactor)),
  };
}

function redactStepResult(s: StepResult, redactor: Redactor): StepResult {
  return {
    ...s,
    source: redactor.redact(s.source),
    ...(s.detail !== undefined ? { detail: redactor.redact(s.detail) } : {}),
    ...(s.request ? { request: redactRequestTrace(s.request, redactor) } : {}),
    ...(s.response ? { response: redactResponseTrace(s.response, redactor) } : {}),
  };
}

function redactRequestTrace(r: RequestTrace, redactor: Redactor): RequestTrace {
  return {
    method: redactor.redact(r.method),
    url: redactor.redact(r.url),
    headers: redactHeaders(r.headers, redactor),
    ...(r.body !== undefined ? { body: redactor.redact(r.body) } : {}),
  };
}

/** `B4-16` (M88c1) — field by field, never `{ ...r }`.
 *
 * The spread this replaced was safe for the fields that existed when it was written and unsafe for
 * every field added afterwards: anything new on `ResponseTrace` passed through *unredacted* unless
 * someone remembered to come back here, and the failure is silent in both directions — no type
 * error, no test, just a secret in `report.html`. `redactRequestTrace`, three lines above, has
 * always listed its fields explicitly and so had the opposite default; two functions in one file
 * disagreeing about which way to fail is how a reviewer finds this, and the sibling that fails
 * closed is the one to copy.
 *
 * `json` and `cookieEvents` are dropped rather than redacted, which is not this function's opinion:
 * the report copy it receives (`interpreter.ts#redactResponse`) never carries either, so listing
 * them would fabricate a field this pass has no redacted form for. `bodyBytes` is the gutted
 * `NO_REPORT_BODY_BYTES` for the same reason — carried, because `ResponseTrace` requires it, and
 * empty. */
function redactResponseTrace(r: ResponseTrace, redactor: Redactor): ResponseTrace {
  return {
    status: r.status,
    statusText: redactor.redact(r.statusText),
    headers: redactHeaders(r.headers, redactor),
    bodyText: redactor.redact(r.bodyText),
    bodyBytes: r.bodyBytes,
    durationMs: r.durationMs,
    finalUrl: redactor.redact(r.finalUrl),
    cookieEvents: [],
  };
}

function redactHeaders(headers: Readonly<Record<string, string>>, redactor: Redactor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = redactor.redact(v);
  return out;
}
