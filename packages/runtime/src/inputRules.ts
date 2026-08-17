// The Tier 3 input-handling rule pack (M134a, PLAN_M134_PENTEST_TIER3.md D373) — deliberately
// `authzRules.ts`'s shape, which is deliberately `securityRules.ts`'s: **this is the only file that
// knows what an input-handling rule is**, it imports `finding.ts`, `inputCorpus.ts` and the trace
// types and nothing else, and it produces the same generic `Finding[]`.
//
// Pure. No interpreter import, no I/O, no clock, no network. `inputProbe.ts` sends; this one only
// judges what came back, which is why every branch below is exercisable against hand-built objects.
//
// ## The bar is disclosure, not status (D373)
//
// **A bare 5xx is not a finding.** Most APIs 500 on genuinely malformed input, and against a
// strict-validation stack most of those 500s would be tflw's own fault for sending something the
// schema never permitted. A rule that scored them would report a wall of findings on a correct
// application, and Tier 1 shipped at *zero false positives* — a bar this plan does not renegotiate.
//
// A 500 that **leaks** is a different thing entirely, judged from the body, with a falsifier a
// reader can check in one glance: a stack frame, a SQL fragment, an ORM exception name, an absolute
// source path. `{"message":"Internal error"}` matches none of them.
//
// The limit this buys is stated rather than hidden: an application that returns a bare 500 to every
// hostile input and discloses nothing **reports clean**. That is the deliberate reading of the
// zero-false-positive bar, and it is not a claim that the application handled the input well.
//
// ## What is different from Tier 2, and why the outcome taxonomy is shorter
//
// Tier 2 has five outcomes because a `5xx` there means *the probe never reached an authorization
// decision* — a non-answer. Here a `5xx` is a first-class answer and possibly the finding itself, so
// the only genuine non-answers left are a `429` (the app never processed the payload) and a probe
// that was never sent. Three states, not five, and the difference is a fact about what each tier is
// asking rather than a simplification.

import type { Finding, FindingSite, Severity } from './finding.js';
import { SEVERITY_RANK } from './finding.js';
import { INPUT_RULE_IDS, type InputRuleId, type MutationSite, type Payload } from './inputCorpus.js';
import type { RequestTrace, ResponseTrace } from './types.js';

/**
 * What became of one mutation probe.
 *
 * `answered` covers every status the host actually produced, `5xx` included — see the header. A
 * `429` is `inconclusive` for Tier 2's reason, unchanged: the app never processed the payload, so
 * scoring it as *the application handled this correctly* would let a suite that trips its own
 * throttle report the throttle as a clean result.
 */
export type MutationOutcome =
  | { readonly kind: 'answered'; readonly status: number }
  | { readonly kind: 'inconclusive'; readonly reason: string }
  | { readonly kind: 'not-probed'; readonly reason: string };

export const MUTATION_OUTCOME_LABEL: Readonly<Record<MutationOutcome['kind'], string>> = {
  answered: 'answered',
  inconclusive: 'inconclusive',
  'not-probed': 'not probed',
};

export interface MutationResult {
  readonly site: MutationSite;
  readonly payload: Payload;
  readonly outcome: MutationOutcome;
  /** Present only when a request was actually sent — so absent for every `not-probed`. */
  readonly response?: ResponseTrace;
}

/** Whether this probe answered the question at all. Exported because it is the predicate D285 turns
 * on, and the interpreter and the reporter must agree with the pack about what counts rather than
 * each re-deriving it — the drift `judgeable` was written to prevent one tier over. */
export function judgeable(o: MutationOutcome): boolean {
  return o.kind === 'answered';
}

/**
 * One assertion's worth of evidence.
 *
 * `observed` is the request the run actually made and the response it actually got (D370) — the
 * **control**. Every differential judgement below is made against it, which is what keeps the pack
 * from needing a second baseline request and what keeps D381's pace bound honest.
 */
export interface InputObservation {
  readonly observed: { readonly request: RequestTrace; readonly response: ResponseTrace };
  readonly probes: readonly MutationResult[];
  /** Which sites the request offered at all. Empty is `TF067`'s condition and travels here so the
   * not-applicable listing can say *why* nothing applied. */
  readonly sites: readonly MutationSite[];
  /** Classes that were not sent because their `probe` sibling line is absent (D372). Named in the
   * not-applicable listing, so a reader can tell *this rule found nothing* from *this rule was never
   * given anything to look at* — the distinction `M128-01` is filed about, and the one place this
   * milestone can afford to answer it. */
  readonly disabledClasses: readonly string[];
}

export interface InputRuleOutcome {
  readonly applicable: boolean;
  readonly findings: readonly Finding[];
  readonly because?: string;
}

export interface InputRule {
  readonly id: InputRuleId;
  readonly severity: Severity;
  readonly description: string;
  readonly appliesWhen: string;
  readonly evaluate: (o: InputObservation) => InputRuleOutcome;
}

// ---------------------------------------------------------------------------
// Detectors — every one a literal or a tight regex, because the bar is zero
// false positives and a fuzzy detector is how a scan loses a team's trust.
// ---------------------------------------------------------------------------

interface Detector {
  readonly what: string;
  /**
   * The same rule `test` applies, as a regular-expression source — what `D472`'s emitted repro
   * asserts against.
   *
   * **A repro cannot re-use the matcher that found the finding** (`D471`): both detector rules
   * subtract the control by label, and in a repro the mutated request *is* the observed request, so
   * the disclosure appears in the control, is subtracted from itself, and the file passes against an
   * unfixed application. So the repro has to name the leak directly, and this is the only place that
   * knows how.
   *
   * Kept beside `test` rather than in a table of its own for the reason `lexer.ts`'s escape help line
   * is derived from `ESCAPES`: a second list is a list that can disagree with the first. A detector
   * added without a pattern is a compile error here, where a missing row in a parallel map would be a
   * silently unassertable finding.
   */
  readonly pattern: string;
  readonly test: (body: string) => string | null;
}

/** Quote a literal needle so it means itself inside `pattern`'s alternation. Without this,
 * `[fonts]` is a character class matching one of five letters and `ORA-0` is unaffected — the first
 * would fire on almost any prose, which is the opposite of these detectors' zero-false-positive bar. */
function quoteForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function literal(what: string, needles: readonly string[]): Detector {
  return {
    what,
    // **The whole family, not the needle that matched.** A finding records the detector's label and
    // not which of its needles hit (`where.invariant` is `what`), so this is the most specific
    // pattern recoverable from a finding — and it is the right generalisation anyway: after the
    // repair none of the family should appear, so the assertion stays true rather than merely
    // becoming true for the one payload that was tried.
    pattern: needles.map(quoteForRegex).join('|'),
    test: (body) => needles.find((n) => body.includes(n)) ?? null,
  };
}

function pattern(what: string, re: RegExp): Detector {
  // `source` and not `toString()`, because the emitted repro carries the pattern as a tflw string and
  // not as a `/…/` literal. Flags are dropped by that, which `input-detectors.test.ts` pins: every
  // detector here is flagless today, and a `/i` added later must teach the emitter to carry it rather
  // than silently emit a case-sensitive assertion for a case-insensitive rule.
  return {
    what,
    pattern: re.source,
    test: (body) => re.exec(body)?.[0] ?? null,
  };
}

/**
 * `sec/error-detail-disclosure`'s evidence.
 *
 * Each entry is something a well-behaved API **cannot** emit by accident. A JSON error envelope, a
 * validation message, a human sentence: none of them match. What matches is machinery leaking —
 * a runtime's own stack format, a database's own error grammar, an ORM's exception class name, a
 * path inside the server's filesystem.
 */
const DISCLOSURE_DETECTORS: readonly Detector[] = [
  // A stack frame's own shape, not merely the word "stack".
  //
  // **Both the raw and the JSON-escaped newline, and the second one is the case that matters.** The
  // commonest disclosure in the wild is not a plain-text stack page, it is a JSON error envelope
  // carrying `{"message":"Error: …\n    at Service.find (…)"}` — and in the response *text* that
  // newline is the two characters `\` and `n`, not U+000A. A detector written only against the raw
  // form matches the shape nobody serves and misses the shape everybody does: `M128`'s
  // fired-for-nobody defect, one tier later, and caught here only because the end-to-end fixture
  // answers with real `JSON.stringify` output instead of a hand-written body.
  pattern('a stack frame', /(?:\n|\\n)\s+at [\w$.<>[\] ]+ \(/),
  literal('a stack trace header', ['Traceback (most recent call last)', 'Exception in thread "', 'goroutine 1 [running]:']),
  // Database error grammar. `SQLSTATE` and `ORA-` are standards; the two phrases are Postgres's and
  // MySQL's verbatim wording for a query the server could not parse — which is precisely what an
  // unbalanced quote produces and precisely what a parameterised query cannot.
  literal('a SQL error fragment', ['SQLSTATE', 'syntax error at or near', 'You have an error in your SQL syntax', 'ORA-0', 'ERROR:  column']),
  // ORM exception class names, printed by a handler that serialised the exception rather than
  // handling it. Class names, not prose, so a message that merely *mentions* a database cannot match.
  literal('an ORM exception name', ['QueryFailedError', 'SequelizeDatabaseError', 'ActiveRecord::StatementInvalid', 'psycopg2.errors', 'PDOException']),
  // An absolute source path *with a line number* — the file:line shape a stack frame or a compiler
  // error carries. A bare `/var/data` in a legitimate response cannot match, because the extension
  // and the line number both have to be there.
  pattern('an absolute source path', /\/(?:usr|home|var|opt|app|srv|root)\/[\w./-]+\.(?:js|ts|mjs|cjs|py|rb|php|go|java):\d+/),
  // Framework debug pages, each an exact title a production deployment should never serve.
  literal('a framework error page', ['Whitelabel Error Page', 'Werkzeug Debugger', 'ActionController::RoutingError', '<title>Django</title>']),
];

/**
 * `sec/path-traversal-read`'s evidence — content only a real file has.
 *
 * A signature, never a path echo. An application that reflects `../../etc/passwd` back in its error
 * message has not read anything, and a rule matching the *payload* would fire on it every time; what
 * matches here is the shape of `/etc/passwd`'s own contents, of a private key, or of a Windows
 * `win.ini`. That is the difference between "the app said your input back" and "the app read a file".
 */
const FILESYSTEM_SIGNATURES: readonly Detector[] = [
  pattern('a Unix passwd entry', /(^|\n)root:[^:\n]*:0:0:/),
  pattern('a Unix shadow entry', /(^|\n)root:[$!*][^:\n]*:\d+:/),
  literal('a private key header', ['-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN OPENSSH PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----']),
  literal('a Windows ini section', ['[fonts]', '[extensions]', '; for 16-bit app support']),
];

/**
 * Every detector's pattern, keyed by the label a finding carries — the join `D472`'s repro emitter
 * needs.
 *
 * A finding's `where.invariant` holds `what` and nothing else, so the label is the *only* handle an
 * emitter downstream of the scan has on the rule that fired. This turns that label back into
 * something assertable.
 *
 * **Both detector families in one map, deliberately.** They belong to different rules
 * (`error-detail-disclosure` and `path-traversal-read`), but the emitter looks a label up without
 * knowing which rule produced it, and two maps would make it ask. Sharing one namespace is also what
 * makes the label collision below worth refusing: two rules' detectors sharing a label would give one
 * finding the other's pattern.
 */
export const DETECTOR_PATTERNS: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const d of [...DISCLOSURE_DETECTORS, ...FILESYSTEM_SIGNATURES]) {
    // Refused at construction rather than left to the test, because the data is static: a duplicate
    // label cannot depend on input, so it is knowable at import and there is no reason for a build to
    // get further. `Object.fromEntries` would have kept the last silently, and the loss is invisible —
    // the emitter would assert the wrong leak's pattern and the repro would still be green.
    if (d.what in out) throw new Error(`two input detectors share the label ${JSON.stringify(d.what)}; a finding's where.invariant could not tell them apart`);
    out[d.what] = d.pattern;
  }
  return Object.freeze(out);
})();

function firstMatch(detectors: readonly Detector[], body: string): { what: string; evidence: string } | null {
  for (const d of detectors) {
    const hit = d.test(body);
    if (hit !== null) return { what: d.what, evidence: hit };
  }
  return null;
}

/** At most 120 characters of matched evidence, on one line. R10's prove-without-reproducing rule: the
 * finding's job is to prove the leak and let the emitted repro re-run it, not to reprint the leak. */
function excerpt(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function contentType(response: ResponseTrace): string {
  const key = Object.keys(response.headers).find((k) => k.toLowerCase() === 'content-type');
  return key === undefined ? '' : response.headers[key]!.toLowerCase();
}

/** The probes a rule is entitled to read: answered, and carrying a payload that declares this rule.
 * D368's per-payload invariants are what make this a lookup rather than a class-name comparison. */
function probesFor(o: InputObservation, rule: InputRuleId): MutationResult[] {
  return o.probes.filter((p) => p.outcome.kind === 'answered' && p.payload.invariants.includes(rule));
}

/**
 * The not-applicable sentence, and it distinguishes the three ways a rule can have nothing to read.
 *
 * `M128-01` is filed against a report that cannot name *which* of its rules stood down and why; this
 * milestone cannot close that row (D384) but it can avoid adding four more rules that are silent
 * about it, which is what this function is for.
 */
function nothingToRead(o: InputObservation, rule: InputRuleId): string {
  if (!o.sites.length) {
    return 'the observed request carries no mutable input — no identifier path segment, no query parameter and no JSON body leaf (`TF067`)';
  }
  const relevant = o.probes.filter((p) => p.payload.invariants.includes(rule));
  if (!relevant.length) {
    return o.disabledClasses.length
      ? `no payload for this rule was sent — its class needs an opt-in this target does not grant (${o.disabledClasses.map((c) => `\`probe ${c}\``).join(', ')})`
      : 'no payload in the corpus carries this invariant for the sites this request offered';
  }
  const answered = relevant.filter((p) => p.outcome.kind === 'answered').length;
  if (!answered) {
    const kinds = new Map<string, number>();
    for (const p of relevant) kinds.set(p.outcome.kind, (kinds.get(p.outcome.kind) ?? 0) + 1);
    const tally = [...kinds].map(([k, n]) => `${n} ${MUTATION_OUTCOME_LABEL[k as MutationOutcome['kind']]}`).join(', ');
    return `${relevant.length} probe${relevant.length === 1 ? '' : 's'} carried this invariant and none was answered (${tally})`;
  }
  return 'no probe carrying this invariant produced a readable response';
}

// ---------------------------------------------------------------------------
// The four rules (D373)
// ---------------------------------------------------------------------------

const errorDetailDisclosure: InputRule = {
  id: INPUT_RULE_IDS.errorDetailDisclosure,
  severity: 'serious',
  description: 'A hostile input made the application disclose its own internals',
  appliesWhen: 'at least one mutation probe was answered',
  evaluate(o) {
    const probes = probesFor(o, INPUT_RULE_IDS.errorDetailDisclosure);
    if (!probes.length) return { applicable: false, findings: [], because: nothingToRead(o, INPUT_RULE_IDS.errorDetailDisclosure) };

    // The control's own body is checked first and its hits are **subtracted**. An application that
    // discloses on every request, mutated or not, has a defect this tier did not find and must not
    // claim: the finding is *this payload caused it*, and that is only true of something the
    // observed response did not already say.
    const controlHit = firstMatch(DISCLOSURE_DETECTORS, o.observed.response.bodyText);

    const findings: Finding[] = [];
    for (const probe of probes) {
      const body = probe.response?.bodyText ?? '';
      const hit = firstMatch(DISCLOSURE_DETECTORS, body);
      if (!hit) continue;
      if (controlHit && controlHit.what === hit.what) continue;
      findings.push({
        id: INPUT_RULE_IDS.errorDetailDisclosure,
        severity: 'serious',
        description: 'A hostile input made the application disclose its own internals',
        detail:
          `${o.observed.request.method} ${pathOf(o.observed.request.url)} — ${site(probe)} carrying \`${probe.payload.id}\` ` +
          `answered ${probe.outcome.kind === 'answered' ? probe.outcome.status : '?'} with ${hit.what}: ${excerpt(hit.evidence)}`,
        // The detector is the invariant: one endpoint leaking a stack frame at one site and an SQL
        // fragment at the same site are two repairs, so they must not share a baseline entry.
        where: siteOf(probe, hit.what),
        payload: probe.payload.id,
      });
    }
    return { applicable: true, findings };
  },
};

const reflectedInputUnescaped: InputRule = {
  id: INPUT_RULE_IDS.reflectedInputUnescaped,
  severity: 'moderate',
  description: 'Input was echoed into a markup response without escaping',
  appliesWhen: 'a payload carrying raw markup metacharacters was answered with an HTML or text body',
  evaluate(o) {
    const probes = probesFor(o, INPUT_RULE_IDS.reflectedInputUnescaped);
    if (!probes.length) return { applicable: false, findings: [], because: nothingToRead(o, INPUT_RULE_IDS.reflectedInputUnescaped) };

    // **A JSON echo is not a finding**, and this is the line that says so. Echoing `<tflw>` inside a
    // JSON string is correct behaviour — JSON has no markup semantics, and the browser that renders
    // it is the one place the escaping belongs. Requiring a markup-ish content type is what keeps
    // this rule off the overwhelming majority of correct APIs.
    const markup = probes.filter((p) => {
      const ct = contentType(p.response!);
      return ct.includes('text/html') || ct.startsWith('text/') || ct.includes('application/xhtml');
    });
    if (!markup.length) {
      return {
        applicable: false,
        findings: [],
        because: `no probe carrying markup metacharacters answered with an HTML or text body (a JSON echo is not a reflection finding — ${probes.length} answered with another content type)`,
      };
    }

    const findings: Finding[] = [];
    for (const probe of markup) {
      const raw = probe.payload.text ?? '';
      if (!raw || !/[<>]/.test(raw)) continue;
      const body = probe.response!.bodyText;
      if (!body.includes(raw)) continue;
      findings.push({
        id: INPUT_RULE_IDS.reflectedInputUnescaped,
        severity: 'moderate',
        description: 'Input was echoed into a markup response without escaping',
        detail:
          `${o.observed.request.method} ${pathOf(o.observed.request.url)} — ${site(probe)} carrying \`${probe.payload.id}\` ` +
          `came back verbatim in a ${contentType(probe.response!).split(';')[0]} body, angle brackets intact`,
        where: siteOf(probe),
        payload: probe.payload.id,
      });
    }
    return { applicable: true, findings };
  },
};

const pathTraversalRead: InputRule = {
  id: INPUT_RULE_IDS.pathTraversalRead,
  severity: 'critical',
  description: 'A traversal payload made the application read a file',
  appliesWhen: '`probe traversal` is granted and at least one traversal payload was answered',
  evaluate(o) {
    const probes = probesFor(o, INPUT_RULE_IDS.pathTraversalRead);
    if (!probes.length) return { applicable: false, findings: [], because: nothingToRead(o, INPUT_RULE_IDS.pathTraversalRead) };

    // Signature-matched against the **control** (D373): an application whose ordinary response
    // already contains something passwd-shaped is not made vulnerable by this probe, and a rule that
    // ignored the baseline would report it as such.
    const controlHit = firstMatch(FILESYSTEM_SIGNATURES, o.observed.response.bodyText);

    const findings: Finding[] = [];
    for (const probe of probes) {
      const hit = firstMatch(FILESYSTEM_SIGNATURES, probe.response?.bodyText ?? '');
      if (!hit) continue;
      if (controlHit && controlHit.what === hit.what) continue;
      findings.push({
        id: INPUT_RULE_IDS.pathTraversalRead,
        severity: 'critical',
        description: 'A traversal payload made the application read a file',
        detail:
          `${o.observed.request.method} ${pathOf(o.observed.request.url)} — ${site(probe)} carrying \`${probe.payload.id}\` ` +
          `returned ${hit.what} the observed response did not contain: ${excerpt(hit.evidence)}`,
        where: siteOf(probe, hit.what),
        payload: probe.payload.id,
      });
    }
    return { applicable: true, findings };
  },
};

const oversizedInputAccepted: InputRule = {
  id: INPUT_RULE_IDS.oversizedInputAccepted,
  severity: 'minor',
  description: 'A value far beyond any plausible bound was accepted',
  appliesWhen: '`probe oversized` is granted and the oversized payload was answered',
  evaluate(o) {
    const probes = probesFor(o, INPUT_RULE_IDS.oversizedInputAccepted);
    if (!probes.length) return { applicable: false, findings: [], because: nothingToRead(o, INPUT_RULE_IDS.oversizedInputAccepted) };

    const findings: Finding[] = [];
    for (const probe of probes) {
      const status = probe.outcome.kind === 'answered' ? probe.outcome.status : 0;
      // **Only a 2xx.** A `413` or a `400` is the application behaving correctly, and this is the
      // rule most at risk of being written the other way round — "it 500'd, so it mishandled it" is
      // both tempting and exactly the bare-5xx finding D373 refuses.
      if (!isSuccess(status)) continue;
      findings.push({
        id: INPUT_RULE_IDS.oversizedInputAccepted,
        severity: 'minor',
        description: 'A value far beyond any plausible bound was accepted',
        detail:
          `${o.observed.request.method} ${pathOf(o.observed.request.url)} — ${site(probe)} accepted ` +
          `${probe.payload.description} with ${status}; no length bound refused it`,
        where: siteOf(probe),
        payload: probe.payload.id,
      });
    }
    return { applicable: true, findings };
  },
};

function site(probe: MutationResult): string {
  return probe.site.location;
}

/**
 * M134b (D376) — R8's rule-side fingerprint input for a Tier 3 finding.
 *
 * `location` is the **site, not the payload**: the same weakness reached by `tflw'` and by `tflw"`
 * is one weakness, and keying on the payload would file it twice and put two entries in a baseline
 * for one repair. That is R8's exclusion of the seed applied to the other attacker-controlled half.
 *
 * The endpoint half is added by the interpreter, which holds the request — see `FindingSite`.
 */
function siteOf(probe: MutationResult, invariant?: string): FindingSite {
  return { location: probe.site.location, ...(invariant !== undefined ? { invariant } : {}) };
}

/** D373's pack. Four rules, and how many of them apply is a fact about the request and the opt-ins
 * rather than a constant — which is what the not-applicable listing exists to explain. */
export const INPUT_RULES: readonly InputRule[] = [errorDetailDisclosure, reflectedInputUnescaped, pathTraversalRead, oversizedInputAccepted];

export interface InputNotApplicable {
  readonly rule: InputRule;
  readonly because: string;
}

export interface InputScanResult {
  readonly findings: readonly Finding[];
  readonly applicable: readonly InputRule[];
  readonly notApplicable: readonly InputNotApplicable[];
  readonly considered: number;
}

/**
 * Runs the pack against one bundle.
 *
 * **The floor narrows the pack before applicability is evaluated**, identically to `runSecurityScan`
 * and `runAuthzScan` — D296, restated rather than re-decided, so that `has no serious input handling
 * violations` means the same kind of thing as its two siblings. Unlike Tier 2's pack this one
 * genuinely spans the scale (`minor` to `critical`), so the floor really does narrow it, and the
 * counts line's denominator moves with it.
 */
export function runInputScan(o: InputObservation, floor: Severity | null = null, pack: readonly InputRule[] = INPUT_RULES): InputScanResult {
  const inPlay = floor ? pack.filter((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[floor]) : pack;
  const findings: Finding[] = [];
  const applicable: InputRule[] = [];
  const notApplicable: InputNotApplicable[] = [];
  for (const rule of inPlay) {
    const outcome = rule.evaluate(o);
    if (!outcome.applicable) {
      notApplicable.push({ rule, because: outcome.because ?? rule.appliesWhen });
      continue;
    }
    applicable.push(rule);
    findings.push(...outcome.findings);
  }
  return { findings, applicable, notApplicable, considered: inPlay.length };
}
