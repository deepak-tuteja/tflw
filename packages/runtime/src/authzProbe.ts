// The authorization probe (M130b1, PLAN_M130B_AUTHZ_ENGINE.md D323–D326) — the I/O half of Tier 2,
// kept in its own file for exactly the reason `tlsProbe.ts` is: `authzRules.ts` must stay pure, and
// a rule that sent a request would end that. The sender is injected, so every branch below is
// exercisable without a network, and `interpreter.ts` does not grow a fifth request path.
//
// ## It rebuilds the request; it does not re-run the step (D323)
//
// The probe is built from the **observed `RequestTrace`** — the method, URL and body that actually
// went out — and not from the `ApiRequestSpec` that produced them. Re-issuing through `execApi` with
// a per-principal context would inherit redirect policy, `retry honoring Retry-After` and mTLS for
// free, and it would also **re-interpolate the path and re-evaluate the body**: `unique(…)`,
// `random(…)` and every `{var}` would resolve a second time, and the probe would ask about a
// resource the owner never touched. That does not implement D303's premise — *the unit of input is a
// request the run actually made* — it falsifies it.
//
// ## A leak requires the resource to have been SERVED (a refinement D324 did not anticipate)
//
// Containment runs on **success statuses only**. The plan's table reads *`401`/`403`/`404`, carrying
// no owner id* → refused, which implies checking a refusal's body for the owner's id. Measured
// against the dogfood target, that is a false-positive machine: the probe re-issues the owner's own
// URL, so the owner's id is *in the request*, and APIs routinely echo it back in the error.
// `categories.service.ts:44` throws ``category ${id} not found``; `cart.service.ts:47` does the same
// for a product. A containment check over those bodies reports a **critical BOLA finding on a
// correctly-refusing endpoint**, and Tier 2's stated bar is zero false positives.
//
// So the semantics are: a leak means the resource was *served*, and a non-2xx did not serve it. What
// this gives up is the rare app that returns a full resource body alongside a 403 — recorded here as
// a known gap rather than traded for a rule that fires on every correct 404.
//
// ## Sequential, and in a fixed order (D326)
//
// Declared order, `anonymous` last. The report reads identically on every run without a sort step,
// the target never sees a simultaneous burst of cross-identity requests from one assertion, and a
// self-inflicted `429` becomes unlikely rather than merely well-classified. The cost is roughly one
// step's latency per principal per assertion site, which D319 commits to recording as a number.

import { allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { containsAnyId, type ProbeOutcome, type ProbeResult } from './authzRules.js';
import type { CookieJar } from './cookieJar.js';
import type { AuthorizedTarget, RequestTrace, ResponseTrace } from './types.js';

/** D306's built-in principal, and D333's reserved name — `session anonymous` is a checker error, so
 * this string can never collide with a declared session. */
export const ANONYMOUS = 'anonymous';

/** The methods that do not change state, and therefore need no opt-in to probe.
 *
 * An allowlist rather than a denylist of `POST|PUT|PATCH|DELETE`: an unrecognised or custom method
 * must count as mutating, because the failure directions are not symmetric. Treating a mutating
 * method as safe sends an unrequested write to somebody's server; treating a safe one as mutating
 * costs a `not probed` line that says exactly what happened. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Whether `authorized target`'s `probe mutating` sub-clause (D330) covers the origin this request
 * went to.
 *
 * **ORs across every matching declaration**, which is where D330's repetition rule is actually
 * implemented: `resolve.ts` keeps accumulating rows so each declaration travels to the report with
 * its own reason, so one origin can legitimately arrive as two rows. If either grants the opt-in,
 * the opt-in holds — the clause is a claim about permission, and permission does not un-grant by
 * being written down twice. Resolving it here rather than by folding rows at resolve time also
 * means the *first* row found can never silently decide it.
 *
 * Origin equality, the same call `authorizedFor` and `checkAuthorizedTargets` make, and for D291's
 * reason: a declaration is an affirmation about one named target, and matching it loosely would make
 * the affirmation cover hosts its author never wrote down. An unparseable URL on either side is not
 * a match — permission is never inferred from something that failed to parse.
 */
export function mayProbeMutating(requestUrl: string, targets: readonly AuthorizedTarget[]): boolean {
  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return false;
  }
  return targets.some((t) => {
    if (!t.probeMutating) return false;
    try {
      return new URL(t.target).origin === origin;
    } catch {
      return false;
    }
  });
}

/**
 * One identity a probe can be sent as.
 *
 * Resolved by the caller (the interpreter, through `SessionCache`) rather than looked up here — this
 * file establishes nothing, which is what keeps it testable without a network and keeps D312's lazy
 * establishment in one place.
 */
export interface ProbePrincipal {
  /** A declared session name, or `ANONYMOUS`. */
  readonly name: string;
  /** What this session's own `header` steps captured. Empty for `anonymous`. */
  readonly headers: Readonly<Record<string, string>>;
  /** This session's jar. Absent for `anonymous`, which applies no identity at all. */
  readonly cookieJar?: CookieJar;
  /** Set when the session would not establish (D312). The probe is then `not probed` with this
   * reason, rather than sent as a half-identity that would read as an anonymous probe. */
  readonly unavailable?: string;
}

export interface ProbePolicy {
  /** The step's own budget. A probe is a request to the host the step just talked to, so the step's
   * patience is already the number describing how long this suite waits on that host — the same
   * reasoning `probeTlsFor` uses rather than a second timeout knob. */
  readonly timeoutMs: number;
  readonly allowHosts?: readonly string[] | null;
  readonly insecure: boolean;
  /** D330's per-`authorized target` opt-in, already resolved for this request's origin. */
  readonly probeMutating: boolean;
}

export interface ProbeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly insecure: boolean;
}

/** The seam. `interpreter.ts` supplies the real one in `M130b2`; the tests supply one that returns
 * hand-built responses, which is how every branch of D324 is reachable without a server. */
export type ProbeSender = (req: ProbeRequest) => Promise<ResponseTrace>;

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Case-insensitive lookup, because a header map preserves the case its author typed — the exact
 * assumption `sec/authenticated-response-cacheable` got wrong in `M128`, where a lowercase key was
 * read against a map that had never lowercased, so the rule fired for nobody while its unit tests
 * passed. Not repeating it costs three lines. */
function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === wanted) return v;
  return undefined;
}

function withoutIdentityHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Whether this principal's identity is carried by the jar alone — no `Authorization` of its own, but
 * cookies that would be sent to this origin.
 *
 * Read off the principal's own establishment outcome, which makes it a fact about the session rather
 * than a guess about the server. It is the precondition for D325's CSRF classification.
 */
export function isCookieBorne(principal: ProbePrincipal, origin: string | undefined): boolean {
  if (headerValue(principal.headers, 'authorization') !== undefined) return false;
  if (!principal.cookieJar || origin === undefined) return false;
  const cookies = principal.cookieJar.serialize(origin);
  return cookies !== undefined && cookies.length > 0;
}

/**
 * The probe request for one principal.
 *
 * Method, URL and body travel **verbatim**. Every other header the observed request carried
 * (`Content-Type`, custom headers) travels unchanged, because they are part of what makes the
 * request the one that was actually made. Only the identity is replaced: `Authorization` and
 * `Cookie` are stripped, then the principal's own are applied. `anonymous` applies neither, which is
 * what makes it a real anonymous request rather than a request with somebody's cookies missing.
 */
export function buildProbeRequest(observed: RequestTrace, principal: ProbePrincipal, policy: ProbePolicy): ProbeRequest {
  const headers = withoutIdentityHeaders(observed.headers);
  for (const [k, v] of Object.entries(principal.headers)) headers[k] = v;

  const origin = originOf(observed.url);
  if (principal.cookieJar && origin !== undefined) {
    // A throwaway clone per probe (D323). Nothing here writes to a jar today, so the isolation is
    // currently inherent — the clone is the insurance that keeps it true if a later edit starts
    // ingesting the probe's own `Set-Cookie`, which must never reach the owning test's jar.
    const cookies = principal.cookieJar.clone().serialize(origin);
    if (cookies) headers['Cookie'] = cookies;
  }

  return {
    method: observed.method,
    url: observed.url,
    headers,
    ...(observed.body === undefined ? {} : { body: observed.body }),
    timeoutMs: policy.timeoutMs,
    insecure: policy.insecure,
  };
}

/**
 * D324's taxonomy, applied to one response.
 *
 * Exported so the tests can drive every branch directly, and so the interpreter cannot grow a second
 * opinion about what a `429` means.
 */
export function classifyResponse(
  response: ResponseTrace,
  ownerIds: readonly string[],
  ctx: { readonly method: string; readonly cookieBorne: boolean },
): ProbeOutcome {
  const status = response.status;

  // Both of these answered without answering the question: the probe demonstrably did not get the
  // resource *and* demonstrably never reached an authorization check. Scoring a rate limiter's
  // refusal as an authorization boundary would let a suite that trips its own throttle report the
  // throttle as a green authorization result.
  if (status === 429) {
    return { kind: 'inconclusive', reason: 'the host answered 429 (rate limited), so the probe never reached an authorization decision' };
  }
  if (status >= 500) {
    return { kind: 'inconclusive', reason: `the host answered ${status}, so the probe never reached an authorization decision` };
  }

  if (status >= 200 && status < 300) {
    if (response.json === undefined) {
      return {
        kind: 'inconclusive',
        reason: `the host answered ${status} with a body that is not JSON, so it cannot be confirmed free of the owner's resource ids`,
      };
    }
    const ids = containsAnyId(response.json, ownerIds);
    if (ids.length) return { kind: 'leaked', ids };
    return { kind: 'served-different', status };
  }

  // D325 / `M130-01`. apiV2's `AnyAuthGuard` requires an `X-CSRF-Token` on every mutating request
  // made with a cookie, and a `session` block does not expose that token — so a cookie-borne
  // principal is refused *before* authorization is consulted, and a differential oracle would score
  // that refusal clean. This is a constraint on the engine, not a bug in the target.
  //
  // The probe is still SENT rather than skipped, which is the whole point: cookie auth with no CSRF
  // defence at all answers 2xx, leaks, and is caught above. A structural pre-flight skip would
  // decline to probe exactly the app most worth catching.
  if (ctx.cookieBorne && !isSafeMethod(ctx.method) && status >= 400 && status < 500) {
    return {
      kind: 'inconclusive',
      reason:
        `a cookie-borne principal was refused on a ${ctx.method.toUpperCase()} (${status}); this may be CSRF rather than authorization, ` +
        'since a cookie session cannot supply the CSRF token a mutating request needs. Give it a bearer session to judge it',
    };
  }

  // 404 sits with the refusals deliberately: answering 404 rather than 403, so as not to disclose
  // that a resource exists, is the *more* careful of two correct implementations, and a tier that
  // scored it as suspicious would fire on the better one.
  if (status === 401 || status === 403 || status === 404) return { kind: 'refused', status };

  // A 400, a 405, a 3xx the sender surfaced: the probe was answered, but not with an authorization
  // decision. `clean` has to be earned, so this is not one.
  return { kind: 'inconclusive', reason: `the host answered ${status}, which is not an authorization decision` };
}

/** Declared order, `anonymous` last (D326). Enforced here rather than trusted from the caller, so
 * the invariant has one home and the report cannot depend on how the probe set was assembled. */
export function probeOrder(principals: readonly ProbePrincipal[]): ProbePrincipal[] {
  return [...principals.filter((p) => p.name !== ANONYMOUS), ...principals.filter((p) => p.name === ANONYMOUS)];
}

export class AuthzProber {
  readonly #send: ProbeSender;

  /** How many requests this prober actually put on the wire. Exposed for the tests that assert a
   * `not probed` principal really sent nothing — a skip whose only evidence is its own label is a
   * skip that could be probing anyway and nobody would know. */
  #sent = 0;

  get sentCount(): number {
    return this.#sent;
  }

  constructor(send: ProbeSender) {
    this.#send = send;
  }

  /**
   * Probes every principal, sequentially, and never throws.
   *
   * Every failure path — a refused host, a session that would not establish, a socket error — comes
   * back as a `ProbeOutcome`, because a probe that could not run is *not applicable* rather than an
   * error. Throwing would fail an assertion that still had a second rule to judge, and would report
   * a network hiccup as an authorization verdict.
   */
  async probeAll(
    observed: RequestTrace,
    ownerIds: readonly string[],
    principals: readonly ProbePrincipal[],
    policy: ProbePolicy,
  ): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    const origin = originOf(observed.url);
    const mutating = !isSafeMethod(observed.method);

    for (const principal of probeOrder(principals)) {
      results.push(await this.#probeOne(observed, ownerIds, principal, policy, { origin, mutating }));
    }
    return results;
  }

  async #probeOne(
    observed: RequestTrace,
    ownerIds: readonly string[],
    principal: ProbePrincipal,
    policy: ProbePolicy,
    ctx: { readonly origin: string | undefined; readonly mutating: boolean },
  ): Promise<ProbeResult> {
    const notProbed = (reason: string): ProbeResult => ({ principal: principal.name, outcome: { kind: 'not-probed', reason } });

    // Safe methods by default; a write needs the per-target affirmation D311 attaches to the host,
    // not a global flag. Checked before anything else, so an un-opted-in mutating step costs no
    // session establishment either.
    if (ctx.mutating && !policy.probeMutating) {
      return notProbed(
        `${observed.method.toUpperCase()} changes state, and no \`probe mutating\` covers ${ctx.origin ?? observed.url} — ` +
          'add it under that `authorized target` to probe writes',
      );
    }

    if (principal.unavailable !== undefined) {
      return notProbed(`session "${principal.name}" could not be established: ${principal.unavailable}`);
    }

    // The allowlist is not a security control this feature is entitled to bypass. In practice the
    // observed request already passed it against this same URL, so this is the belt to that's
    // braces — but a guardrail that is only correct because of something another file did is one
    // edit away from not being.
    if (!isHostAllowed(observed.url, policy.allowHosts)) {
      return notProbed(allowHostsRefusal(observed.url, policy.allowHosts!, { kind: 'authz-probe', principal: principal.name }));
    }

    const request = buildProbeRequest(observed, principal, policy);
    let response: ResponseTrace;
    try {
      this.#sent++;
      response = await this.#send(request);
    } catch (err) {
      return notProbed(`the probe request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      principal: principal.name,
      outcome: classifyResponse(response, ownerIds, {
        method: observed.method,
        cookieBorne: isCookieBorne(principal, ctx.origin),
      }),
      response,
    };
  }
}
