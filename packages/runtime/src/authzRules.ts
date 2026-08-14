// The Tier 2 authorization rule pack (M130b1, PLAN_M130B_AUTHZ_ENGINE.md D320–D322/D324) — the
// BOLA/IDOR half of the security arc, and deliberately `securityRules.ts`'s exact shape: **this is
// the only file that knows what an authorization rule is**, it imports `finding.ts` and the trace
// types and nothing else, and it produces the same generic `Finding[]`.
//
// Pure. No interpreter import, no I/O, no clock, no network. `authzProbe.ts` is the file that sends
// a request; this one only judges what came back, which is why every branch below is exercisable
// against hand-built objects.
//
// ## What is different from Tier 1, and why the shape had to change
//
// A hygiene rule looks at **one** response and asks whether it is well-formed. An authorization rule
// looks at **N** responses — the owner's, plus one per non-owning principal — and asks whether they
// differ in the way an authorization boundary would make them differ. So the input is a bundle
// (`AuthzObservation`) rather than a flattened single response, and a rule is called **once per
// assertion**, not once per probe.
//
// That choice is load-bearing for two things. `sec/authz-collection-leak` can say something about
// the probe *set* rather than about one member of it. And the counts line keeps meaning what it
// means in Tier 1 — `2 rules — 1 applicable, 1 not applicable, 0 violations` — a denominator of
// rules, not of rules × principals. Evaluating per-probe and merging would silently redefine the
// number under the second matcher.
//
// ## Applicability is gated on the owner's body shape (D320)
//
// | owner's 2xx body                  | object-leak    | collection-leak |
// | --------------------------------- | -------------- | --------------- |
// | object with a root `id`           | applicable     | not applicable  |
// | array of objects with root `id`s  | not applicable | applicable      |
// | anything else                     | not applicable | not applicable  |
//
// The third row is the one that matters: a `200` whose body this oracle cannot read engages **no
// rule at all**, and D285's inherited machinery then reports *this assertion had no power to fail*
// instead of a green. D315 asked for exactly that and asked for it to fall out of the existing
// machinery rather than need a rule of its own; gating on shape is what makes it fall out.
//
// The same door closes a second way. A probe set in which nothing was actually judged — every
// principal inconclusive or never probed — also makes the rule not applicable, so `clean` is
// reachable only by a probe that really answered. See `judgeable` below.

import type { Finding, Severity } from './finding.js';
import { SEVERITY_RANK } from './finding.js';
import type { RequestTrace, ResponseTrace } from './types.js';

/**
 * What became of one principal's probe (D324).
 *
 * Five states, and only two of them are a pass. Everything that answered without answering the
 * question is `inconclusive`; everything that never asked is `not-probed`. The distinction is the
 * whole point of the taxonomy: with three states (violation / clean / not-probed) the counts line
 * could no longer tell *the boundary held* from *we could not tell*, and a rate limiter's refusal
 * would be indistinguishable from an authorization decision.
 */
export type ProbeOutcome =
  /** An owner id came back. A violation. */
  | { readonly kind: 'leaked'; readonly ids: readonly string[] }
  /** `401`/`403`/`404` carrying no owner id — the boundary held.
   *
   * `404` sits here deliberately. Answering `404` rather than `403`, so as not to disclose that a
   * resource exists, is the *more* careful of two correct implementations, and a tier that scored it
   * as suspicious would fire on the better one. */
  | { readonly kind: 'refused'; readonly status: number }
  /** A `2xx` carrying no owner id — the boundary held, by filtering rather than by refusing. This is
   * the collection case `authz.tflw` had to hand-write, and the one a status-code oracle cannot see
   * at all. */
  | { readonly kind: 'served-different'; readonly status: number }
  /** The probe demonstrably did not get the resource *and* demonstrably never reached an
   * authorization check: a `429`, any `5xx`, a body this oracle cannot read, or D325's CSRF case. */
  | { readonly kind: 'inconclusive'; readonly reason: string }
  /** No request went out: a mutating method with no `probe mutating`, a session that would not
   * establish, or a transport failure. */
  | { readonly kind: 'not-probed'; readonly reason: string };

/** Human wording for one outcome, in one place, so the reporter, the not-applicable listing and the
 * failure detail cannot drift into three vocabularies for the same five states. */
export const PROBE_OUTCOME_LABEL: Readonly<Record<ProbeOutcome['kind'], string>> = {
  leaked: 'leaked',
  refused: 'refused',
  'served-different': 'served different content',
  inconclusive: 'inconclusive',
  'not-probed': 'not probed',
};

/**
 * Whether this probe answered the question **at all** — in either direction.
 *
 * A leak is an answer, and the most informative one there is. Conflating this with *the boundary
 * held* is a live hazard rather than a hypothetical: the first draft of this file defined
 * `judgeable` as `refused || served-different`, and its own unit test caught the consequence
 * immediately — a probe set whose only member **leaked** engaged no rule, so the rule reported
 * *no principal produced a judgeable response*, and a critical finding was silently downgraded to
 * a not-applicable. The two questions look like one and are not.
 *
 * Exported because it is the predicate D285 turns on, and the interpreter and the reporter must
 * agree with the pack about it rather than each re-deriving "does this count".
 */
export function judgeable(o: ProbeOutcome): boolean {
  return o.kind === 'leaked' || o.kind === 'refused' || o.kind === 'served-different';
}

/** Whether the probe answered *in the app's favour* — D324's two clean rows, and only those. The
 * distinction from `judgeable` above is what stops a leak being mistaken for a non-answer, and what
 * stops a `429` being mistaken for an authorization boundary. */
export function boundaryHeld(o: ProbeOutcome): boolean {
  return o.kind === 'refused' || o.kind === 'served-different';
}

export interface ProbeResult {
  /** A declared session name, or `'anonymous'` (D306's built-in principal, D333's reserved name). */
  readonly principal: string;
  readonly outcome: ProbeOutcome;
  /** Present only when a request was actually sent — so absent for every `not-probed`. */
  readonly response?: ResponseTrace;
}

/**
 * One assertion's worth of evidence.
 *
 * `owner` is the request the run actually made and the response it actually got (D303) — not an
 * `ApiRequestSpec`, because re-resolving a spec re-runs `unique(…)`/`random(…)`/`{var}` and asks
 * about a resource the owner never touched.
 */
export interface AuthzObservation {
  readonly owner: { readonly request: RequestTrace; readonly response: ResponseTrace };
  /** Every session the test named (D327). `test "…" as admin, shopper` is legal and live in the
   * dogfood suite, and the observed request then carries admin's bearer *and* shopper's cookie at
   * once — a bearer and a cookie do not conflict, so precedence never resolves them and both
   * travel. So the owner is the union, and every listed session is excluded from the probe set. */
  readonly ownerPrincipals: readonly string[];
  /** D321's extraction, already performed by the caller (the prober needs it too, so it is computed
   * once and passed rather than derived twice from the same body). */
  readonly ownerIds: readonly string[];
  readonly probes: readonly ProbeResult[];
}

/** A rule's verdict. Structurally `securityRules.ts`'s `RuleOutcome`, restated rather than imported
 * so that pack cannot acquire a dependency on this one — the direction of the arrow between the two
 * tiers is that there isn't one, and §0 of the plan freezes Tier 1 for this milestone. */
export interface AuthzRuleOutcome {
  readonly applicable: boolean;
  readonly findings: readonly Finding[];
  /** Replaces the static `appliesWhen` in the not-applicable listing when *which* half of the
   * precondition failed is itself worth reading. Every rule here uses it, because "the owner's body
   * is an object with a root `id`" is untrue of a `404`, of an envelope and of a bare scalar in
   * exactly the same words, and those are three different situations for a reader to act on. */
  readonly because?: string;
}

export interface AuthzRule {
  readonly id: string;
  readonly severity: Severity;
  readonly description: string;
  readonly appliesWhen: string;
  readonly evaluate: (o: AuthzObservation) => AuthzRuleOutcome;
}

// ---------------------------------------------------------------------------
// D321 — resource-identity extraction, and it reaches the bare shapes only.
// ---------------------------------------------------------------------------

/** An `id` is accepted as a string or a number and compared stringified. Nothing else: `true` is not
 * an identity, and `null` is the absence of one. */
function idValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v.length ? v : undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The owner's resource identity, from the owner's own response body.
 *
 * - an **object** → its root `id`, if present
 * - an **array** → each element's root `id`
 * - **nothing else**. Nothing nested, no key aliases (`_id`, `uuid`), no envelope unwrapping.
 *
 * ```
 * { "id": "a1", items: [ { productId: "p1" } ] }    → { a1 }   (p1 is nested; not a resource id)
 * [ { "id": "a1" }, { "id": "a2" } ]                → { a1, a2 }
 * { "data": [ { "id": "r1" } ], "nextCursor": "…" } → { }      NOT APPLICABLE
 * { "orderId": "a1" }                               → { }      NOT APPLICABLE
 * ```
 *
 * **This is narrow on purpose and it will look broken before it looks careful.** The parent plan's
 * instruction is to scope v1 to the plain shapes, report the unrecognised ones as *no resource
 * identity found* — a not-applicable, never a pass — and widen only with evidence. The evidence
 * available does not yet argue for widening: apiV2 has exactly one enveloped list on the wire
 * (`GET /products/{id}/reviews` → `{ data, nextCursor }`), and it is a **public** per-product
 * collection, not a surface anyone writes a BOLA assertion against. Unwrapping an envelope means
 * guessing which key is the payload, and a guess belongs least in the one file whose stated bar is
 * zero false positives.
 *
 * The widening trigger is therefore a real suite reporting *no resource identity found* on an
 * endpoint that does have an authorization boundary — which is why the failure message names the
 * shape it read.
 */
export function extractResourceIds(json: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const id = idValue(v);
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };

  if (Array.isArray(json)) {
    for (const el of json) if (isPlainObject(el)) push(el['id']);
  } else if (isPlainObject(json)) {
    push(json['id']);
  }
  return out;
}

// ---------------------------------------------------------------------------
// D322 — containment, and it is deliberately asymmetric with extraction.
// ---------------------------------------------------------------------------

/**
 * Which of the owner's ids appear anywhere in a probe's parsed body.
 *
 * Walks every scalar leaf to any depth, stringifies it, and tests **exact equality**. The asymmetry
 * with `extractResourceIds` is the point: a leak returned under a different key, or wrapped in an
 * envelope the owner's own response did not use, is still a leak.
 *
 * ```
 * owner ids = { a1e3 }
 * probe { "id": "a1e3" }                      → [a1e3]   VIOLATION
 * probe { "data": [ { "orderId": "a1e3" } ] } → [a1e3]   VIOLATION  (nested, different key)
 * probe { "total": 41 }                       → []       clean
 * ```
 *
 * **Exact leaf equality rather than a substring search** is what keeps short ids safe: a numeric
 * `id: 1` is compared as a whole leaf and cannot match the `1` inside `"total": 41` or a timestamp.
 * A substring oracle would need a minimum-id-length threshold, and a threshold is a tuning knob in
 * the one file that is not allowed one.
 *
 * Iterative rather than recursive so a deeply nested body cannot overflow the stack in a security
 * check — the depth that reaches here is whatever `JSON.parse` accepted, which is not this code's
 * to bound.
 */
export function containsAnyId(json: unknown, ids: readonly string[]): string[] {
  if (!ids.length || json === undefined) return [];
  const wanted = new Set(ids);
  const found = new Set<string>();
  const stack: unknown[] = [json];

  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const el of node) stack.push(el);
    } else if (isPlainObject(node)) {
      for (const k of Object.keys(node)) stack.push(node[k]);
    } else {
      const leaf = idValue(node);
      if (leaf !== undefined && wanted.has(leaf)) found.add(leaf);
    }
    if (found.size === wanted.size) break;
  }
  // Report in the owner's own order, so two runs over the same leak read identically.
  return ids.filter((id) => found.has(id));
}

// ---------------------------------------------------------------------------
// Owner body shape — the gate D320's table describes.
// ---------------------------------------------------------------------------

export type OwnerShape = 'object' | 'array' | 'unreadable';

export function ownerShape(response: ResponseTrace): OwnerShape {
  const json = response.json;
  if (Array.isArray(json)) return json.some((el) => isPlainObject(el) && idValue(el['id']) !== undefined) ? 'array' : 'unreadable';
  if (isPlainObject(json)) return idValue(json['id']) !== undefined ? 'object' : 'unreadable';
  return 'unreadable';
}

/** The shape the oracle read, in words, for the not-applicable listing. Names what it *saw*, so the
 * widening evidence for D321 arrives as a user report rather than as speculation. */
function describeOwnerBody(response: ResponseTrace): string {
  const json = response.json;
  if (json === undefined) return 'a body that is not JSON';
  if (Array.isArray(json)) return json.length ? 'a JSON array whose elements carry no root `id`' : 'an empty JSON array';
  if (isPlainObject(json)) {
    const keys = Object.keys(json);
    const shown = keys.slice(0, 4).map((k) => `\`${k}\``).join(', ');
    return `a JSON object with no root \`id\` (keys: ${shown}${keys.length > 4 ? ', …' : ''})`;
  }
  return 'a JSON body that is a bare scalar';
}

function isSuccess(response: ResponseTrace): boolean {
  return response.status >= 200 && response.status < 300;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** At most three ids, then a count. A collection leak can return hundreds, and the finding's job is
 * to prove the leak and let the emitted repro re-run it — `PLAN_REPORTS_PERF_SECURITY.md` R10's
 * prove-without-reproducing rule. The full set stays on the `ProbeResult` for the repro emitter. */
function idList(ids: readonly string[]): string {
  const shown = ids.slice(0, 3).map((id) => `"${id}"`).join(', ');
  return ids.length > 3 ? `${shown} and ${ids.length - 3} more` : shown;
}

/**
 * The shared body of both rules: same evidence, same failure, different owner shape.
 *
 * Kept as one function rather than two because the only thing that differs between an object leak
 * and a collection leak is *which* body shape engages it — and writing that twice is how the two
 * drift into disagreeing about what a leak is.
 */
function leakRule(args: {
  readonly id: string;
  readonly shape: Exclude<OwnerShape, 'unreadable'>;
  readonly description: string;
  readonly appliesWhen: string;
  readonly noun: string;
}): AuthzRule {
  return {
    id: args.id,
    severity: 'critical',
    description: args.description,
    appliesWhen: args.appliesWhen,
    evaluate(o) {
      const { request, response } = o.owner;

      // The owner's own request has to have succeeded, or there is no authorized baseline for a
      // probe to differ from. A 403 owner probed by four principals who all also get 403 is not a
      // demonstration that the boundary works; it is a demonstration that nobody got in.
      if (!isSuccess(response)) {
        return {
          applicable: false,
          findings: [],
          because: `the owner's own response was ${response.status}, so there is no authorized baseline to differ from`,
        };
      }

      const shape = ownerShape(response);
      if (shape !== args.shape) {
        return {
          applicable: false,
          findings: [],
          because:
            shape === 'unreadable'
              ? `no resource identity found — the owner returned ${describeOwnerBody(response)}; this rule reads a root \`id\` on an object, or on each element of an array`
              : `the owner returned ${shape === 'array' ? 'an array' : 'an object'}, and this rule judges ${args.noun}`,
        };
      }

      // `clean` has to be earned. If no principal produced an answer this oracle can read, the
      // assertion had no power to fail, and it says so through the same not-applicable door a
      // shape mismatch uses — so D285 fires once, in one place, for both reasons.
      const judged = o.probes.filter((p) => judgeable(p.outcome));
      if (!judged.length) {
        const tally = summarise(o.probes);
        return {
          applicable: false,
          findings: [],
          because: o.probes.length ? `no principal produced a judgeable response (${tally})` : 'no principal was available to probe',
        };
      }

      const findings: Finding[] = [];
      for (const probe of o.probes) {
        if (probe.outcome.kind !== 'leaked') continue;
        findings.push({
          id: args.id,
          severity: 'critical',
          description: args.description,
          detail:
            `${request.method} ${pathOf(request.url)} — \`${probe.principal}\` is not an owner ` +
            `(${o.ownerPrincipals.length ? `owners: ${o.ownerPrincipals.join(', ')}` : 'no owner declared'}) ` +
            `and received resource ${probe.outcome.ids.length === 1 ? 'id' : 'ids'} ${idList(probe.outcome.ids)}`,
          // M134b (D376) — the **principal** is R8's location here, because this tier's probes move
          // an identity rather than a payload: one endpoint readable by two principals who should
          // not have it is two repairs. Deliberately *not* the resource ids, which are generated per
          // fixture and are exactly the run-to-run churn R8 excludes.
          where: { location: probe.principal },
        });
      }
      // One finding per violating principal, not one per assertion: the answer to *which principals
      // can read this* is the whole output, and collapsing two leaks into one throws half of it away.
      return { applicable: true, findings };
    },
  };
}

/** `2 inconclusive, 1 not probed` — outcome counts for a not-applicable reason, in a fixed order so
 * the sentence is stable across runs. */
function summarise(probes: readonly ProbeResult[]): string {
  const order: ProbeOutcome['kind'][] = ['leaked', 'refused', 'served-different', 'inconclusive', 'not-probed'];
  const counts = new Map<string, number>();
  for (const p of probes) counts.set(p.outcome.kind, (counts.get(p.outcome.kind) ?? 0) + 1);
  return order
    .filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${PROBE_OUTCOME_LABEL[k]}`)
    .join(', ');
}

const authzObjectLeak = leakRule({
  id: 'sec/authz-object-leak',
  shape: 'object',
  description: 'A single resource was served to a principal that does not own it',
  appliesWhen: "the owner's 2xx response is a JSON object carrying a root `id`, and at least one principal was judgeable",
  noun: 'a single resource',
});

const authzCollectionLeak = leakRule({
  id: 'sec/authz-collection-leak',
  shape: 'array',
  description: "A collection served another principal's resources to a caller that does not own them",
  appliesWhen: "the owner's 2xx response is a JSON array of objects carrying root `id`s, and at least one principal was judgeable",
  noun: 'a collection',
});

/** D320's pack. Two rules, and exactly one of them can apply to any given response — which is what
 * makes the ordinary counts line read `2 rules — 1 applicable, 1 not applicable`. */
export const AUTHZ_RULES: readonly AuthzRule[] = [authzObjectLeak, authzCollectionLeak];

export interface AuthzNotApplicable {
  readonly rule: AuthzRule;
  readonly because: string;
}

/** Structurally Tier 1's `ScanResult`, with `AuthzRule` in place of `SecurityRule`. Restated rather
 * than made generic: one shared generic type would couple the two packs' evolution, and §0 of the
 * plan freezes Tier 1 for this milestone precisely so that Tier 2 cannot perturb it. */
export interface AuthzScanResult {
  readonly findings: readonly Finding[];
  readonly applicable: readonly AuthzRule[];
  readonly notApplicable: readonly AuthzNotApplicable[];
  /** `applicable.length + notApplicable.length` — the denominator M126 requires to travel on the
   * same line as the counts, and not necessarily the whole pack, because the floor narrows first. */
  readonly considered: number;
}

/**
 * Runs the pack against one bundle.
 *
 * **The floor narrows the pack before applicability is evaluated**, identically to
 * `runSecurityScan` — D296, restated here rather than re-decided, so that `has no critical
 * authorization violations` and `has no critical security violations` mean the same kind of thing.
 * Both rules here are `critical`, so today the floor never actually narrows this pack; the code
 * is written as though it might, because the day a third rule lands at a lower severity is not the
 * day to discover the two matchers disagree about what a floor does.
 */
export function runAuthzScan(o: AuthzObservation, floor: Severity | null = null, pack: readonly AuthzRule[] = AUTHZ_RULES): AuthzScanResult {
  const inPlay = floor ? pack.filter((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[floor]) : pack;
  const findings: Finding[] = [];
  const applicable: AuthzRule[] = [];
  const notApplicable: AuthzNotApplicable[] = [];
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
