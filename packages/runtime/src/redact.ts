// Taint redaction (PLAN P#30). Every value read via `env(NAME)` is registered here with its
// concrete value; anywhere that concrete value later appears — request header, body, URL, or
// derived interpolation — it is rendered `•••(NAME)`. Value-based redaction (rather than
// header-blocklists) means a secret in a login body or a URL is caught wherever it flows, so
// report.html and CLI output are ticket-attachable by construction.

import type { AttemptResult, RequestTrace, ResponseTrace, RunReport, StepResult, TestResult } from './types.js';

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

  /** Register that `value` entered via `env(name)`. Empty values, and values shorter than
   * `MIN_REDACTABLE_LENGTH` (decision 64), are ignored — nothing to hide, or too short to hide
   * safely. Also registers the value's JSON-string-body encoding (quotes/backslashes/newlines
   * escaped) — a secret embedded in a `body { … }` object is serialised through `JSON.stringify`
   * before it ever reaches `redact()`, so a secret containing any of those characters would
   * otherwise appear in its escaped form and dodge a plain substring match (P#46). */
  register(name: string, value: string): void {
    if (value.length < MIN_REDACTABLE_LENGTH) return;
    this.addName(value, name);
    const jsonEscaped = JSON.stringify(value).slice(1, -1);
    if (jsonEscaped !== value) this.addName(jsonEscaped, name);
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
  return { ...report, tests: report.tests.map((t) => redactTestResult(t, redactor)) };
}

function redactTestResult(t: TestResult, redactor: Redactor): TestResult {
  return {
    ...t,
    name: redactor.redact(t.name),
    ...(t.error !== undefined ? { error: redactor.redact(t.error) } : {}),
    steps: t.steps.map((s) => redactStepResult(s, redactor)),
    ...(t.attempts ? { attempts: t.attempts.map((a) => redactAttemptResult(a, redactor)) } : {}),
  };
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

function redactResponseTrace(r: ResponseTrace, redactor: Redactor): ResponseTrace {
  return { ...r, statusText: redactor.redact(r.statusText), headers: redactHeaders(r.headers, redactor), bodyText: redactor.redact(r.bodyText) };
}

function redactHeaders(headers: Readonly<Record<string, string>>, redactor: Redactor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = redactor.redact(v);
  return out;
}
