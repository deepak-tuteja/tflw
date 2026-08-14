// The mutation probe (M134a, PLAN_M134_PENTEST_TIER3.md D370/D372/D374/D381) — the I/O half of
// Tier 3, in its own file for exactly the reason `tlsProbe.ts` and `authzProbe.ts` are: the rule
// pack must stay pure, and a rule that sent a request would end that. The sender is injected, so
// every branch below is exercisable without a network, and `interpreter.ts` does not grow a sixth
// request path. Third instance of the seam, and the first that can cite two precedents.
//
// ## It rebuilds the request; it does not re-run the step (D370, reusing D323)
//
// The probe is built from the **observed `RequestTrace`** — the method, URL and body that actually
// went out — and not from the `ApiRequestSpec` that produced them. Re-issuing through `execApi`
// would re-interpolate the path and re-evaluate the body, so `unique(…)`, `random(…)` and every
// `{var}` would resolve a second time and the probe would mutate an input the observed request never
// carried. That does not implement D303's premise, it falsifies it.
//
// ## It changes the payload and NOTHING else — and that is the whole tier (D370/D375)
//
// Tier 2 strips `Authorization` and `Cookie` and applies a different principal's identity. Tier 3
// changes **no identity**: same principal, same credentials, same headers, same method. Only one
// input moves, and only to one payload at a time.
//
// That is not a simplification, it is what makes `M130-01` not this tier's problem. Tier 2's
// cookie-borne probe is refused for CSRF before authorization is consulted, because the new
// principal has no token matching the session. Here the observed request's own `X-CSRF-Token`
// travels unchanged with every other header, the guard admits the probe, and the mutated payload
// reaches the code it was sent to test. The row stays open, stays S4, and stays Tier 2's.
//
// ## Sequential, one in flight, and `probe rate` does not come due (D381)
//
// D21 layer 5 shipped as an **asserted bound rather than a declared pace**: probes strictly
// sequential, one in flight per assertion, held by a test. Its deferral condition is *the first
// change that permits two probes in flight simultaneously*. Tier 3 adds volume, not concurrency —
// the corpus is walked in order, one request at a time — so the condition is not met and the
// deferral stands. "Tier 3 sends a lot of requests" reads like the trigger and is not it. If a real
// corpus makes an assertion take minutes the answer is a cap or a per-class narrowing; concurrency
// is the thing layer 5 exists to prevent.

import { allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { publicTargetRefusal } from './authzProbe.js';
import {
  applyMutation,
  CLASS_OPT_IN,
  DEFAULT_ON_CLASSES,
  enabledPayloads,
  INPUT_CORPUS,
  mutationSites,
  payloadsForSite,
  type MutationClass,
  type MutationSite,
  type Payload,
} from './inputCorpus.js';
import type { MutationOutcome, MutationResult } from './inputRules.js';
import type { AuthorizedTarget, RequestTrace, ResponseTrace } from './types.js';

/** `authzProbe.ts`'s allowlist, reused rather than restated. An unrecognised or custom method counts
 * as mutating, because the failure directions are not symmetric: treating a mutating method as safe
 * sends an unrequested write to somebody's server, and treating a safe one as mutating costs a `not
 * probed` line that says exactly what happened. */
export { isSafeMethod } from './authzProbe.js';
import { isSafeMethod } from './authzProbe.js';

export interface InputProbeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly insecure: boolean;
}

/** The seam. `interpreter.ts` supplies the real one; the tests supply one that returns hand-built
 * responses, which is how every branch below is reachable without a server. */
export type InputProbeSender = (req: InputProbeRequest) => Promise<ResponseTrace>;

export interface InputProbePolicy {
  /** The step's own budget — a probe goes to the host the step just talked to, so the step's
   * patience is already the number describing how long this suite waits on that host. */
  readonly timeoutMs: number;
  readonly allowHosts?: readonly string[] | null;
  readonly insecure: boolean;
  /** D372 — a mutating method still needs `probe mutating`, unchanged. The two gates answer
   * different questions ("may I re-send a write?" and "may I send *this kind* of hostile value?")
   * and Tier 3 weakens neither. */
  readonly probeMutating: boolean;
  /** Which of the four classes this target has granted (D372). */
  readonly classes: readonly MutationClass[];
  /** `--allow-public-target` values this invocation carried (M131a, D340/D342). Tier 3 originates
   * traffic the suite did not write, so D21 §3.2(3) applies to it exactly as it does to Tier 2 —
   * and only this side sees the origin the packet is actually going to. */
  readonly allowPublicTargets?: readonly string[];
}

/**
 * Which mutation classes an `authorized target` grants for this request's origin (D372).
 *
 * **ORs across every matching declaration**, which is D330's repetition rule reused: `resolve.ts`
 * accumulates a row per declaration so each travels to the report with its own reason, and one
 * origin can legitimately arrive as two rows. If either grants a class, the class is granted — the
 * clause is a claim about permission, and permission does not un-grant by being written twice.
 *
 * Origin equality, and an unparseable URL on either side is not a match: permission is never
 * inferred from something that failed to parse.
 */
export function grantedClasses(requestUrl: string, targets: readonly AuthorizedTarget[]): MutationClass[] {
  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return [...DEFAULT_ON_CLASSES];
  }
  const granted = new Set<MutationClass>(DEFAULT_ON_CLASSES);
  for (const t of targets) {
    let same = false;
    try {
      same = new URL(t.target).origin === origin;
    } catch {
      same = false;
    }
    if (!same) continue;
    if (t.probeOversized) granted.add('oversized');
    if (t.probeTraversal) granted.add('traversal');
  }
  // Corpus order, not `Set` insertion order, so the report reads identically whichever way the
  // declarations happened to be written.
  const order: MutationClass[] = ['type-confusion', 'injection', 'oversized', 'traversal'];
  return order.filter((c) => granted.has(c));
}

/** The opt-in classes this target did **not** grant, by their sub-clause word — for the
 * not-applicable listing, so a rule that stood down for want of permission says so. */
export function withheldClasses(granted: readonly MutationClass[]): string[] {
  return Object.entries(CLASS_OPT_IN)
    .filter(([klass]) => !granted.includes(klass as MutationClass))
    .map(([, word]) => word);
}

/** One planned probe: a site, a payload, and nothing else. Materialised before any request goes out
 * so the count is knowable in advance — which is what lets the cost line be a measurement rather
 * than an estimate, and what a future `M134b` corpus cap would bound. */
export interface PlannedProbe {
  readonly site: MutationSite;
  readonly payload: Payload;
}

/**
 * The full matrix, in a fixed order: every site in request order, and within each site every enabled
 * payload in corpus order (D368).
 *
 * No sampling, no RNG, no shuffling. Two runs of the same suite against the same target send the
 * same requests in the same order, which is what makes a finding reproducible and a baseline stable.
 */
export function planProbes(request: RequestTrace, classes: readonly MutationClass[], corpus: readonly Payload[] = INPUT_CORPUS): PlannedProbe[] {
  const payloads = enabledPayloads(classes, corpus);
  const plan: PlannedProbe[] = [];
  for (const site of mutationSites(request)) {
    for (const payload of payloadsForSite(site, payloads)) plan.push({ site, payload });
  }
  return plan;
}

export class InputProber {
  readonly #send: InputProbeSender;

  /** How many requests this prober actually put on the wire. Exposed for the tests that assert a
   * refused class really sent nothing — a skip whose only evidence is its own label is a skip that
   * could be probing anyway and nobody would know. */
  #sent = 0;

  get sentCount(): number {
    return this.#sent;
  }

  constructor(send: InputProbeSender) {
    this.#send = send;
  }

  /**
   * Walks the matrix, sequentially, and never throws.
   *
   * Every failure path — a refused host, an unaffirmed public target, a socket error — comes back as
   * a `MutationOutcome`, because a probe that could not run is *not applicable* rather than an error.
   * Throwing would abandon an assertion that still had three rules to judge, and would report a
   * network hiccup as an input-handling verdict.
   */
  async probeAll(observed: RequestTrace, plan: readonly PlannedProbe[], policy: InputProbePolicy): Promise<MutationResult[]> {
    const results: MutationResult[] = [];

    // Judged **once per assertion and before the first probe**, against the origin the packet is
    // actually going to rather than against anything a config predicted (D342's runtime door).
    const unaffirmedPublic = publicTargetRefusal(observed.url, policy.allowPublicTargets ?? [], 'an input-handling scan');
    const mutating = !isSafeMethod(observed.method);

    for (const planned of plan) {
      results.push(await this.#probeOne(observed, planned, policy, { unaffirmedPublic, mutating }));
    }
    return results;
  }

  async #probeOne(
    observed: RequestTrace,
    planned: PlannedProbe,
    policy: InputProbePolicy,
    ctx: { readonly unaffirmedPublic: string | null; readonly mutating: boolean },
  ): Promise<MutationResult> {
    const notProbed = (reason: string): MutationResult => ({ site: planned.site, payload: planned.payload, outcome: { kind: 'not-probed', reason } });

    // D21 §3.2(3) first, before anything about *what* would be sent — it asks whether this run may
    // talk to that host at all. A refusal is an outcome rather than a throw, and it is still
    // fail-closed rather than a silent pass: with every probe refused no rule applies, and D285
    // reports "this assertion had no power to fail" as a *failure*. The gate refuses the packets and
    // the assertion goes red, which is both halves of what a safety control has to do.
    if (ctx.unaffirmedPublic !== null) return notProbed(ctx.unaffirmedPublic);

    // A write still needs the per-target affirmation D311 attached to the host. Checked before the
    // class opt-in, because it is the stronger claim: permission to send *any* re-issued write.
    if (ctx.mutating && !policy.probeMutating) {
      return notProbed(
        `${observed.method.toUpperCase()} changes state, and no \`probe mutating\` covers this target — ` +
          'add it under that `authorized target` to mutate writes',
      );
    }

    if (!policy.classes.includes(planned.payload.class)) {
      const word = CLASS_OPT_IN[planned.payload.class];
      return notProbed(
        word
          ? `\`${planned.payload.class}\` payloads need \`probe ${word}\` under this \`authorized target\``
          : `\`${planned.payload.class}\` payloads are not enabled for this target`,
      );
    }

    // The allowlist is not a security control this feature is entitled to bypass. In practice the
    // observed request already passed it against this same URL, so this is the belt to that's
    // braces — but a guardrail that is only correct because of something another file did is one
    // edit away from not being.
    if (!isHostAllowed(observed.url, policy.allowHosts)) {
      return notProbed(allowHostsRefusal(observed.url, policy.allowHosts!, { kind: 'authz-probe', principal: 'input-handling probe' }));
    }

    const mutated = applyMutation(observed, planned.site, planned.payload);
    const request: InputProbeRequest = {
      method: observed.method,
      url: mutated.url,
      headers: { ...observed.headers },
      ...(mutated.body === undefined ? {} : { body: mutated.body }),
      timeoutMs: policy.timeoutMs,
      insecure: policy.insecure,
    };

    let response: ResponseTrace;
    try {
      this.#sent++;
      response = await this.#send(request);
    } catch (err) {
      return notProbed(`the probe request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { site: planned.site, payload: planned.payload, outcome: classifyMutationResponse(response), response };
  }
}

/**
 * One response → one outcome.
 *
 * **A `5xx` is `answered`, and that is the difference from Tier 2** (D373). There a `5xx` means the
 * probe never reached an authorization decision, so it is a non-answer; here the application did
 * process the payload and its response is exactly what the disclosure rule reads. A `429` stays a
 * non-answer for Tier 2's reason, unchanged: the app never processed the payload at all, so scoring
 * it as clean would let a suite that trips its own throttle report the throttle as a passing result.
 *
 * Exported so the tests can drive both branches directly and so the interpreter cannot grow a second
 * opinion about what a `429` means.
 */
export function classifyMutationResponse(response: ResponseTrace): MutationOutcome {
  if (response.status === 429) {
    return { kind: 'inconclusive', reason: 'the host answered 429 (rate limited), so it never processed the payload' };
  }
  return { kind: 'answered', status: response.status };
}
